"""Build Skytide's editable game boards from the supplied design multiviews.

Run with Blender 5.2:
  blender --background --factory-startup --python tools/models/boards_build.py

Design coordinates: meters, Z up, +Y nose. glTF export converts to +Y up,
-Z nose. Root origin and independently adjustable binding origins are at the
boot sole / deck contact plane. All paint is literal base color; no baked light.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

BASE = Path(__file__).resolve().parents[2]
OUT = BASE / 'art/models/production'
PREVIEW = BASE / 'art/models/previews'
ASSETS = BASE / 'assets/models'
for directory in (OUT, PREVIEW, ASSETS):
    directory.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version=0


def material(name, color):
    # Design palette is specified in display sRGB; Blender and glTF factors use linear.
    color=tuple(c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in color)
    mat = bpy.data.materials.new('cel_' + name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = 0
    p.inputs['Roughness'].default_value = 0.84
    p.inputs['Specular IOR Level'].default_value = 0.18
    mat['paint_only'] = True
    return mat


def empty(name, parent=None, location=(0, 0, 0), **extras):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    ob.location = location
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = .06
    for k, v in extras.items():
        ob[k] = v
    return ob


def prism(name, outline, z0, z1, mat, parent, bevel=.002, rise=None):
    """Closed extrusion of a CCW or CW XY perimeter, optional deck rocker."""
    count = len(outline)
    vertices = [(x, y, z) for z in (z0, z1) for x, y in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count)
              for i in range(count)]
    mesh = bpy.data.meshes.new(name + '_mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if rise:
        # Cut the broad deck exactly at each rocker transition BEFORE raising
        # vertices. A single nonplanar ngon would slope across the foot contacts.
        for y in [-.73,-.70,.68,.72]:
            if min(p[1] for p in outline)<y<max(p[1] for p in outline):
                bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                    dist=1e-7,plane_co=(0,y,0),plane_no=(0,1,0))
        for v in bm.verts:
            v.co.z+=rise(v.co.x,v.co.y)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    ob.data.materials.append(mat)
    # These are small paint/inlay/fastener surfaces. Their visible material edges
    # already describe them; expanding another hull makes submillimeter layers
    # collide with the structural contour in the game's screen-space outline.
    if any(token in name for token in ('_Paint','_Seam','_Mark','_Tread','_Insert',
            '_Cushion','Trapar_','_Cyan','_Fastener','_Bolt','_Lens','_Gasket',
            '_Mustard','_Teal','_Tail_Tip','_Nose_Paint','_Accent')):
        ob['skipOutline']=True
    if bevel:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        mod = ob.modifiers.new('Controlled edge bevel', 'BEVEL')
        mod.width = min(bevel,abs(z1-z0)*.3)
        mod.segments = 1
        mod.affect = 'EDGES'
        bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.select_set(False)
    return ob


def box(name, center, size, mat, parent, bevel=.002):
    x, y, z = center
    a, b, c = [s / 2 for s in size]
    return prism(name, [(x-a,y-b),(x+a,y-b),(x+a,y+b),(x-a,y+b)], z-c, z+c,
                 mat, parent, bevel)


def mirror(poly, side):
    return [(x * side, y) for x, y in poly]


def cylinder(name, radius, depth, center, mat, parent, vertices=20):
    x, y, z = center
    poly = [(x + radius * math.cos(i * math.tau / vertices),
             y + radius * math.sin(i * math.tau / vertices)) for i in range(vertices)]
    return prism(name, poly, z-depth/2, z+depth/2, mat, parent, min(.002,depth/5))


def line(name, coords, width, depth, mat, parent):
    # Each segment is a closed small prism, so outlines do not rely on curves.
    for i, (a, b) in enumerate(zip(coords, coords[1:])):
        x, y, z = a
        X, Y, Z = b
        dx, dy = X-x, Y-y
        n = max(math.hypot(dx, dy), 1e-8)
        nx, ny = -dy/n*width/2, dx/n*width/2
        prism(f'{name}_{i+1}',[(x+nx,y+ny),(X+nx,Y+ny),(X-nx,Y-ny),(x-nx,y-ny)],
              min(z,Z)-depth/2,max(z,Z)+depth/2,mat,parent,0)


def polygon_panel(name, poly, z, thickness, mat, parent, border=None, bevel=.002):
    if border:
        cx=sum(p[0] for p in poly)/len(poly)
        cy=sum(p[1] for p in poly)/len(poly)
        border_poly=[(cx+(x-cx)*1.045,cy+(y-cy)*1.035) for x,y in poly]
        # Underside panels extend below their shallow perimeter gasket.
        prism(name+'_Gasket',border_poly,z-thickness*.3,z+.001,border,parent,bevel)
    return prism(name,poly,z-thickness,z,mat,parent,bevel)


def energy(name, poly, z, parent, mats):
    ob=prism('Trapar_'+name,poly,z-.002,z+.001,mats['energy'],parent,.0008)
    ob['role']='trapar'
    ob['emission_driver']='ride_and_boost'
    ob['base_emission']=0.0
    return ob


def bindings(root, mats, model):
    for label, y, foot in [('Front', .32, 'L'), ('Rear', -.32, 'R')]:
        pivot=empty('FootHold_'+label,root,(0,y,0),role='foothold',foot=foot,
                    sole_axis='+X',contact_plane=.014,rotation_axis='Y_up_in_gltf',
                    footbedHeight=.014,nominal_boot_length=.26,nominal_boot_width=.11)
        # The footbed extends down from the sole plane, so placing a foot at the
        # pivot does not require additional runtime sole height compensation.
        shape=[(-.13,-.039),(-.112,-.061),(.075,-.061),(.132,-.041),(.143,-.014),
               (.143,.028),(.123,.052),(.079,.061),(-.11,.061),(-.13,.039)]
        prism('Binding_'+label+'_Footbed',shape,-.013,0,mats['dark'],pivot,.004)
        # Cushion remains below the contact plane. Paint seams are deliberate.
        inset=[(x*.90,y*.83) for x,y in shape]
        prism('Binding_'+label+'_Cushion',inset,-.0025,.0002,mats['pad'],pivot,.002)
        for i,x in enumerate([-.085,-.05,-.015,.02,.055,.09]):
            box(f'Binding_{label}_Tread_{i+1}',(x,0,.0008),(.003,.085,.0014),
                mats['dark'],pivot,.0004)
        for sign,suffix in [(-1,'Inner'),(1,'Outer')]:
            # Low lateral brackets outside boot sole; no longitudinal joins to deck.
            box(f'Binding_{label}_{suffix}_Bracket',(-.008,sign*.070,.012),
                (.153,.019,.040),mats['cream'],pivot,.004)
            box(f'Binding_{label}_{suffix}_Latch',(-.008,sign*.080,.015),
                (.044,.008,.022),mats['accent'],pivot,.002)
        # Arched ankle strap is five closed pieces, leaving an actual boot cavity.
        # A boot 0.11 m wide, up to .10 m high, fits inside the strap envelope.
        strap_poly=[(-.073,-.006),(-.021,-.006),(-.021,.006),(-.073,.006)]
        for sign,suffix in [(-1,'A'),(1,'B')]:
            ob=box(f'Binding_{label}_Strap_{suffix}',(-.047,sign*.060,.063),
                   (.052,.014,.093),mats['cream'],pivot,.003)
            ob.rotation_euler[0]=sign*math.radians(11)
        box(f'Binding_{label}_Strap_Crown',(-.047,0,.107),(.052,.111,.014),
            mats['cream'],pivot,.004)
        box(f'Binding_{label}_Strap_Insert',(-.047,0,.115),(.028,.067,.004),
            mats['pad'],pivot,.001)
        # Low heel bumper; the whole assembly turns about the pivot at the sole.
        box(f'Binding_{label}_Heel_Stop',(-.13,0,.021),(.013,.084,.043),
            mats['dark'],pivot,.003)
        cylinder(f'Binding_{label}_Turntable',.067,.012,(0,0,-.018),
                 mats['dark'],pivot,24)
        for s in [-1,1]:
            cylinder(f'Binding_{label}_Bolt_{s}',.006,.003,(-.008,s*.067,.034),
                     mats['dark'],pivot,10)
        # A real, shallow padded bed lies 14 mm above the deck; the independent
        # pivot remains on the deck. Runtime reads footbedHeight to match soles.
        for child in pivot.children:
            child.location.z+=.014
    return [bpy.data.objects['FootHold_Front'],bpy.data.objects['FootHold_Rear']]


def skipper(mats, root):
    rocker=lambda x,y:max(y-.68,0)*.085 + max(-y-.73,0)*.035
    core=[(-.075,.98),(.075,.98),(.157,.81),(.194,.64),(.207,.27),
          (.202,.15),(.174,-.12),(.179,-.37),(.200,-.58),(.193,-.72),
          (.167,-.91),(.109,-.98),(.073,-.98),(.050,-.735),
          (-.050,-.735),(-.073,-.98),(-.109,-.98),(-.167,-.91),
          (-.193,-.72),(-.200,-.58),(-.179,-.37),(-.174,-.12),
          (-.202,.15),(-.207,.27),(-.194,.64),(-.157,.81)]
    prism('Skipper_Core_Frame',[(x*1.05,y) for x,y in core],-.080,-.057,mats['dark'],root,.003,rocker)
    prism('Skipper_Deck_Edge',[(x*1.015,y) for x,y in core],-.020,-.012,mats['dark'],root,.002,rocker)
    prism('Skipper_Cream_Deck',core,-.017,0,mats['cream'],root,.003,rocker)
    outer=[(.075,.98),(.183,.81),(.253,.61),(.282,.34),(.280,.17),
           (.248,-.12),(.241,-.36),(.258,-.56),(.250,-.72),(.192,-.85),(.172,-.93)]
    inner=[(.062,.955),(.148,.79),(.209,.60),(.236,.34),(.236,.17),
           (.211,-.12),(.203,-.36),(.218,-.56),(.212,-.70),(.159,-.82),(.142,-.91)]
    for side,suf in [(-1,'Left'),(1,'Right')]:
        rail=outer+list(reversed(inner))
        prism('Skipper_'+suf+'_Navy_Rail',mirror(rail,side),-.078,-.047,mats['dark'],root,.003,rocker)
        # Segmented mustard jackets leave purposeful navy mechanical joints.
        for a,b,title in [(0,2,'Nose'),(2,4,'Forward'),(4,7,'Waist'),(7,9,'Tail')]:
            pts=outer[a:b+1]+list(reversed(inner[a:b+1]))
            # A fitted jacket has a real 3 mm overhang over its structural rail.
            # Reusing identical side planes causes z-fighting after glTF export.
            half=len(pts)//2
            pts=[(x+(.003 if i<half else -.003),y) for i,(x,y) in enumerate(pts)]
            # shorten joins around cross ribs, not random erosion in color map
            cy=sum(p[1] for p in pts)/len(pts)
            pts=[(x,cy+(y-cy)*.90) for x,y in pts]
            prism(f'Skipper_{suf}_Mustard_{title}',mirror(pts,side),-.075,-.043,
                  mats['accent'],root,.003,rocker)
        for y in [.61,.16,-.36,-.65]:
            x=.215 if y<0 else .230
            box(f'Skipper_{suf}_Crossbrace_{y}',(side*x,y,-.039),(.070,.046,.052),
                mats['dark'],root,.003)
        # Main tail forks retain the reference's mustard tips and navy recess.
        tail=[(.055,-.78),(.174,-.78),(.166,-.91),(.108,-.978),(.074,-.975)]
        prism(f'Skipper_{suf}_Tail_Tip',mirror(tail,side),-.045,.002,mats['accent'],root,.003,rocker)
        # Two small outward vanes, each an addressable hinged assembly.
        pivot=empty('Fin_'+suf,root,(side*.235,-.715,-.031),role='fin',side=suf)
        vane=[(0,0),(.053,-.036),(.139,-.195),(.145,-.254),(.115,-.235),(-.017,-.073)]
        prism('Skipper_'+suf+'_Vane',mirror(vane,side),-.019,.019,mats['dark'],pivot,.004)
        stripe=[(.017,-.015),(.055,-.052),(.138,-.203),(.142,-.248),(.119,-.225),(.026,-.083)]
        prism('Skipper_'+suf+'_Vane_Paint',mirror(stripe,side),.017,.022,mats['accent'],pivot,.002)
        cylinder('Skipper_'+suf+'_Hinge',.031,.054,(0,0,0),mats['dark'],pivot,16)
        cylinder('Skipper_'+suf+'_Hinge_Bolt',.013,.057,(0,0,0),mats['cream'],pivot,12)
        for child in pivot.children:
            if 'Vane' in child.name:
                for v in child.data.vertices:v.co.z+=v.co.y*.25
        # Controlled deck seam routes and short non-emissive service marks.
        route=[(side*.147,.68,.003),(side*.127,.62,.003),(side*.127,.06,.003),
               (side*.163,.009,.003),(side*.14,-.18,.003),(side*.14,-.62,.003),
               (side*.115,-.75,.003)]
        line('Skipper_'+suf+'_Deck_Seam',route,.003,.001,mats['seam'],root)
        for y in [-.10,-.88]:
            box(f'Skipper_{suf}_Vent_{y}',(side*(.159 if y>-.5 else .117),y,.004),
                (.008,.070,.003),mats['dark'],root,.001)
    # Nose chevron and understated registration mark.
    for side in [-1,1]:
        prism('Skipper_Nose_Paint_'+str(side),mirror([(.065,.975),(.079,.973),(.174,.795),(.131,.771)],side),
              .002,.007,mats['accent'],root,.001,rocker)
    energy('Skipper_Nose',[(-.006,.827),(.006,.827),(.006,.910),(-.006,.910)],.018,root,mats)
    box('Skipper_Center_Service_Mark',(0,-.015,.002),(.078,.008,.003),mats['seam'],root,.001)
    # Broad cyan plates and the circular aft mechanism are deliberate underside design.
    for name,y0,y1,w in [('Fore',.40,.755,.160),('Mid',-.075,.347,.160),('Aft',-.339,-.124,.145)]:
        poly=[(-w+.025,y0), (w-.025,y0),(w,y0+.032),(w,y1-.033),
              (w-.027,y1),(-w+.027,y1),(-w,y1-.033),(-w,y0+.032)]
        polygon_panel('Skipper_Underside_'+name,poly,-.078,.009,mats['cyan'],root,mats['seam'])
        for x in [-w+.028,w-.028]:
            for y in [y0+.035,y1-.035]:
                cylinder(f'Skipper_{name}_Fastener_{x}_{y}',.006,.004,(x,y,-.089),mats['dark'],root,10)
    cylinder('Skipper_Reactor_Housing',.116,.048,(0,-.577,-.086),mats['dark'],root,32)
    cylinder('Skipper_Reactor_Rim',.090,.009,(0,-.577,-.113),mats['accent'],root,32)
    cylinder('Skipper_Reactor_Seal',.072,.011,(0,-.577,-.120),mats['seam'],root,32)
    cylinder('Skipper_Reactor_Lens',.056,.012,(0,-.577,-.127),mats['cyan'],root,32)
    # Energy aperture is its own mesh, deliberately not baked into the cyan paint.
    ob=cylinder('Trapar_Skipper_Reactor_Core',.040,.003,(0,-.577,-.135),mats['energy'],root,24)
    ob['role']='trapar';ob['base_emission']=0.0
    # The side concept exposes matching ringed end-caps on a transverse housing.
    for side,suf in [(-1,'Left'),(1,'Right')]:
        for title,radius,depth,x,mat in [
                ('Housing',.067,.030,.105,mats['dark']),
                ('Rim',.054,.006,.123,mats['accent']),
                ('Seal',.042,.007,.127,mats['seam']),
                ('Lens',.034,.008,.131,mats['cyan'])]:
            ob=cylinder('Skipper_Reactor_'+suf+'_'+title,radius,depth,(0,0,0),mat,root,24)
            ob.rotation_euler[1]=math.pi/2
            ob.location=(side*x,-.577,-.075)
    for side,suf in [(-1,'Left'),(1,'Right')]:
        energy('Skipper_'+suf+'_Tail',[ (side*.078,-.764),(side*.089,-.767),
                 (side*.112,-.917),(side*.098,-.923)],-.050,root,mats)
    return bindings(root,mats,'skipper')


def kestrel(mats, root):
    rocker=lambda x,y:max(y-.72,0)*.07+max(-y-.70,0)*.045
    core=[(-.023,1.05),(.023,1.05),(.086,.875),(.067,.77),(.083,.53),
          (.115,.22),(.102,.06),(.104,-.20),(.078,-.53),(.041,-.765),
          (.020,-.801),(-.020,-.801),(-.041,-.765),(-.078,-.53),
          (-.104,-.20),(-.102,.06),(-.115,.22),(-.083,.53),(-.067,.77),(-.086,.875)]
    prism('Kestrel_Central_Plum_Spine',[(x*1.09,y) for x,y in core],-.068,-.053,mats['dark'],root,.003,rocker)
    prism('Kestrel_Deck_Edge',[(x*1.02,y) for x,y in core],-.019,-.012,mats['dark'],root,.002,rocker)
    prism('Kestrel_Cream_Deck',core,-.016,0,mats['cream'],root,.0025,rocker)
    outer=[(.025,1.05),(.105,.87),(.157,.75),(.202,.54),(.248,.23),
           (.260,.11),(.246,-.18),(.218,-.42),(.177,-.66),(.142,-.77)]
    inner=[(.015,1.01),(.076,.855),(.105,.735),(.145,.52),(.190,.23),
           (.206,.11),(.198,-.18),(.178,-.42),(.138,-.65),(.110,-.76)]
    for side,suf in [(-1,'Left'),(1,'Right')]:
        rail=outer+list(reversed(inner))
        prism('Kestrel_'+suf+'_Rail_Structure',mirror(rail,side),-.079,-.035,mats['dark'],root,.003,rocker)
        # Continuous turquoise rails, with fine dark corner planes and purposeful joins.
        for a,b,title in [(1,9,'Continuous')]:
            pts=outer[a:b+1]+list(reversed(inner[a:b+1]))
            half=len(pts)//2
            pts=[(x+(.003 if i<half else -.003),y) for i,(x,y) in enumerate(pts)]
            prism('Kestrel_'+suf+'_Teal_'+title,mirror(pts,side),-.060,-.031,mats['accent'],root,.003,rocker)
        shoulder=[(.201,.114),(.257,.115),(.249,.004),(.205,-.031)]
        prism('Kestrel_'+suf+'_Plum_Shoulder',mirror(shoulder,side),-.066,-.030,mats['dark'],root,.002)
        # Four discrete webs leave actual rail openings at the upper and lower thirds.
        for y,outerx,width in [(.72,.125,.045),(.47,.160,.035),(.22,.220,.050),(-.09,.218,.042),(-.53,.165,.040),(-.70,.131,.035)]:
            innerx=.075 if y>.4 else (.10 if y>-.3 else .06)
            box(f'Kestrel_{suf}_Web_{y}',(side*(innerx+outerx)/2,y,-.034),
                (outerx-innerx+.015,width,.047),mats['dark'] if abs(y)<.3 else mats['cream'],root,.002)
        # Underside carrier strips are inset from the rails. Openings remain open.
        carrier=[(.043,.755),(.100,.755),(.144,.55),(.187,.25),(.177,.08),
                 (.174,-.18),(.148,-.43),(.113,-.66),(.042,-.715)]
        prism('Kestrel_'+suf+'_Under_Carrier',mirror(carrier,side),-.076,-.048,mats['dark'],root,.003)
        plates=[('Fore',[(.054,.70),(.096,.715),(.123,.667),(.153,.429),(.128,.397),(.054,.419)]),
                ('Mid',[(.054,.39),(.133,.374),(.165,.347),(.182,.132),(.161,.106),(.054,.128)]),
                ('Lower',[(.054,.086),(.154,.066),(.168,.025),(.148,-.210),(.118,-.236),(.054,-.212)]),
                ('Tail',[(.054,-.241),(.116,-.260),(.144,-.283),(.111,-.564),(.088,-.611),(.054,-.592)])]
        for title,poly in plates:
            poly=mirror(poly,side)
            polygon_panel('Kestrel_'+suf+'_Cyan_'+title,poly,-.083,.007,mats['cyan'],root,mats['seam'],.0015)
            for i in [0,2,4]:
                x,y=poly[i];cx=sum(p[0] for p in poly)/len(poly);cy=sum(p[1] for p in poly)/len(poly)
                x=cx+(x-cx)*.83;y=cy+(y-cy)*.91
                cylinder(f'Kestrel_{suf}_{title}_Fastener_{i}',.004,.003,(x,y,-.092),mats['dark'],root,8)
        # Long independent tail blades, narrow and swept out from their hinges.
        pivot=empty('Fin_'+suf,root,(side*.126,-.739,-.025),role='fin',side=suf)
        blade=[(-.016,.009),(.022,-.010),(.108,-.272),(.112,-.311),(.084,-.280),(-.035,-.075)]
        prism('Kestrel_'+suf+'_Tail_Blade',mirror(blade,side),-.023,.016,mats['dark'],pivot,.0025)
        paint=[(-.007,-.009),(.015,-.019),(.101,-.270),(.106,-.303),(.086,-.278),(-.022,-.071)]
        prism('Kestrel_'+suf+'_Tail_Teal',mirror(paint,side),.014,.020,mats['accent'],pivot,.0015)
        cylinder('Kestrel_'+suf+'_Hinge_Casing',.031,.060,(0,0,0),mats['dark'],pivot,16)
        cylinder('Kestrel_'+suf+'_Hinge_Cap',.016,.063,(0,0,0),mats['seam'],pivot,12)
        cylinder('Kestrel_'+suf+'_Hinge_Pin',.008,.065,(0,0,0),mats['cream'],pivot,12)
        for child in pivot.children:
            if 'Tail_' in child.name:
                for v in child.data.vertices:v.co.z+=v.co.y*.22
        # Graphic lines follow the cream blade, rather than noisy generated creases.
        line('Kestrel_'+suf+'_Deck_Seam',[(side*.015,.97,.026),(side*.060,.79,.008),
              (side*.037,.71,.003),(side*.035,.46,.003),(side*.080,.35,.003)],
              .002,.001,mats['seam'],root)
        line('Kestrel_'+suf+'_Tail_Seam',[(side*.058,-.45,.003),
              (side*.025,-.70,.003),(side*.010,-.774,.006)],.002,.001,mats['seam'],root)
        # A slim underside light ribbon follows each rail without repainting it green.
        energy('Kestrel_'+suf+'_Rail',mirror([(.191,.184),(.198,.183),(.186,-.15),(.178,-.151)],side),-.075,root,mats)
    coral=[(-.012,-.069),(.012,-.069),(.019,-.028),(.019,.059),(.003,.080),
           (-.013,.058),(-.019,-.029)]
    prism('Kestrel_Coral_Deck_Mark',coral,.001,.004,mats['coral'],root,.001)
    # Central longitudinal backbone gives the underside its characteristic layout.
    spine=[(-.021,.764),(.021,.764),(.027,.10),(.030,-.40),(.021,-.715),
           (-.021,-.715),(-.030,-.40),(-.027,.10)]
    prism('Kestrel_Underside_Center_Spine',spine,-.093,-.078,mats['pad'],root,.002)
    prism('Kestrel_Coral_Underside_Accent',[(-.016,-.12),(.016,-.12),(.021,-.08),
           (.021,.09),(.014,.115),(-.014,.115),(-.021,.09),(-.021,-.08)],
           -.099,-.093,mats['coral'],root,.001)
    energy('Kestrel_Center_Aperture',[(-.006,-.114),(.006,-.114),(.006,-.045),(-.006,-.045)],-.101,root,mats)
    return bindings(root,mats,'kestrel')


def camera(scene, location, target, scale):
    ob=bpy.data.objects.get('Review_Camera')
    if not ob:
        dat=bpy.data.cameras.new('Review_Camera')
        ob=bpy.data.objects.new('Review_Camera',dat)
        scene.collection.objects.link(ob)
    ob.location=location
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    ob.data.type='ORTHO';ob.data.ortho_scale=scale
    scene.camera=ob
    return ob


def render_views(model,pivots):
    scene=bpy.context.scene
    scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=1100
    scene.render.resolution_y=1300
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.film_transparent=False
    sh=scene.display.shading
    sh.light='STUDIO';sh.studiolight_rotate_z=.4;sh.color_type='MATERIAL'
    sh.show_shadows=True;sh.show_cavity=True;sh.cavity_type='BOTH'
    sh.curvature_ridge_factor=1.15;sh.curvature_valley_factor=.8
    sh.cavity_ridge_factor=1.0;sh.cavity_valley_factor=.7
    sh.show_object_outline=True;sh.object_outline_color=(.075,.088,.12)
    sh.background_type='WORLD';scene.world.color=(.70,.74,.77)
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='Medium High Contrast'
    for label,loc,scale in [('top',(0,0,4),2.28),('underside',(0,0,-4),2.28),
                            ('quarter',(2.2,-2.7,3.6),2.40)]:
        cam=camera(scene,loc,(0,0,0),scale)
        if label=='underside':cam.rotation_euler=(0,math.pi,0)
        scene.render.filepath=str(PREVIEW/f'{model}-{label}.png')
        bpy.ops.render.render(write_still=True)
    scene.render.resolution_x=1700;scene.render.resolution_y=650
    camera(scene,(4,0,.05),(0,0,0),2.40)
    scene.render.filepath=str(PREVIEW/f'{model}-side.png')
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x=1100;scene.render.resolution_y=1300
    pivots[0].rotation_euler[2]=math.radians(28)
    pivots[1].rotation_euler[2]=math.radians(-19)
    camera(scene,(0,0,4),(0,0,0),2.28)
    scene.render.filepath=str(PREVIEW/f'{model}-binding-swivel.png')
    bpy.ops.render.render(write_still=True)
    for p in pivots:p.rotation_euler=(0,0,0)
    camera(scene,(2.2,-2.7,3.6),(0,0,0),2.40)


def audit(root,pivots):
    meshes=[o for o in root.children_recursive if o.type=='MESH']
    total_tri=0;nonmanifold=[];degenerate=[];bad_finite=[]
    allverts=[]
    for ob in meshes:
        ob.data.calc_loop_triangles();total_tri+=len(ob.data.loop_triangles)
        allverts.extend([tuple(ob.matrix_world@v.co) for v in ob.data.vertices])
        bm=bmesh.new();bm.from_mesh(ob.data)
        nm=sum(not e.is_manifold for e in bm.edges)
        dg=sum(f.calc_area()<1e-11 for f in bm.faces)
        if nm:nonmanifold.append([ob.name,nm])
        if dg:degenerate.append([ob.name,dg])
        if any(not math.isfinite(c) for v in bm.verts for c in v.co):bad_finite.append(ob.name)
        bm.free()
    bounds=[[min(v[i] for v in allverts),max(v[i] for v in allverts)] for i in range(3)]
    return {'triangles':total_tri,'meshes':len(meshes),'bounds_blender_meters':bounds,
            'nonmanifold_edges':nonmanifold,'degenerate_faces':degenerate,'nonfinite':bad_finite,
            'footholds':[{'name':p.name,'foot':p['foot'],'children':len(p.children),
                          'footbedHeight':p['footbedHeight'],
                          'origin_blender':list(p.location),'origin_gltf':[p.location.x,p.location.z,-p.location.y]}
                          for p in pivots],
            'trapar_surfaces':[o.name for o in meshes if o.get('role')=='trapar'],
            'textures':0,'external_dependencies':0,
            'design_source':'Original mara lift board design.png and tavi lift board design.png; pose renders excluded from dimensional authority',
            'binding_test':'Independent +28/-19 degree Z rotations rendered, then restored to neutral',
            'coordinate_contract':'Meters, glTF Y up nose -Z, deck sole plane Y=0, boot toe +X'}


def build(model):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
    root=empty('Board_'+model.title(),asset=model,asset_version=1,units='meters',
               nose_axis='-Z_in_gltf',up_axis='+Y_in_gltf',contact_plane=0.0)
    # Colors use the painted references; under-panel cyan is paint, green is live energy.
    mats={
        'cream':material(model+'_ivory',(.94,.915,.835)),
        'dark':material(model+'_navy' if model=='skipper' else model+'_plum',
                        (.17,.23,.29) if model=='skipper' else (.29,.235,.34)),
        'accent':material(model+'_mustard' if model=='skipper' else model+'_teal',
                          (.90,.65,.23) if model=='skipper' else (.25,.60,.57)),
        'pad':material(model+'_binding_pad',(.20,.27,.34) if model=='skipper' else (.33,.265,.38)),
        'seam':material(model+'_seam',(.45,.46,.45) if model=='skipper' else (.40,.34,.44)),
        'cyan':material(model+'_underplate',(.43,.69,.75) if model=='skipper' else (.57,.75,.78)),
        'energy':material(model+'_trapar_aperture',(.40,.75,.38)),
        'coral':material(model+'_coral',(.90,.47,.41)),
    }
    pivots=skipper(mats,root) if model=='skipper' else kestrel(mats,root)
    # The original, complete concept sheets are the dimensional authority.
    # Scale authored board geometry and fin pivots, retaining boot-size bindings.
    sx,sy=(.48/.570,1.62/1.96) if model=='skipper' else (.40/.526,1.86/2.10)
    binding_objects=set(pivots + [o for p in pivots for o in p.children_recursive])
    for ob in root.children_recursive:
        if ob in binding_objects:
            continue
        if ob.type=='MESH':
            for v in ob.data.vertices:
                v.co.x*=sx;v.co.y*=sy
        ob.location.x*=sx;ob.location.y*=sy
    root['nominal_length']=1.62 if model=='skipper' else 1.86
    root['nominal_width']=.48 if model=='skipper' else .40
    for side,suf in [(-1,'Left'),(1,'Right')]:
        empty('Wake_'+suf,root,(side*(.187 if model=='skipper' else .12),-.65,-.035),
              role='wake_socket',side=suf)
    bpy.context.view_layer.update()
    result=audit(root,pivots)
    result['nominal_length_m']=root['nominal_length']
    result['nominal_body_width_m']=root['nominal_width']
    assert not result['nonmanifold_edges'],result['nonmanifold_edges']
    assert not result['degenerate_faces'],result['degenerate_faces']
    assert not result['nonfinite'],result['nonfinite']
    assert result['triangles']<15000,result['triangles']
    render_views(model,pivots)
    # The editable blend retains every named panel and bracket.
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{model}.blend'))
    # Batch static parts by material within each semantic parent for the runtime
    # GLB. Pivots, fins and individual Trapar surfaces retain their identities.
    groups={}
    for ob in root.children_recursive:
        if ob.type=='MESH' and ob.get('role')!='trapar':
            groups.setdefault((ob.parent,ob.data.materials[0],bool(ob.get('skipOutline'))),[]).append(ob)
    for (parent,mat,skip_outline),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objects:ob.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        objects[0].name=parent.name+'_'+mat.name.removeprefix('cel_')+('_Detail' if skip_outline else '')
        objects[0]['skipOutline']=skip_outline
    result['export_meshes']=sum(o.type=='MESH' for o in root.children_recursive)
    # Export just the model; review camera never becomes a runtime node.
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in root.children_recursive:o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(ASSETS/f'{model}.glb'),export_format='GLB',
        use_selection=True,export_extras=True,export_yup=True,export_apply=True,
        export_materials='EXPORT',export_cameras=False,export_lights=False)
    result['blend']=str((OUT/f'{model}.blend').relative_to(BASE))
    result['glb']=str((ASSETS/f'{model}.glb').relative_to(BASE))
    return result


audit_results={name:build(name) for name in ('skipper','kestrel')}
(OUT/'boards-audit.json').write_text(json.dumps(audit_results,indent=2)+'\n')
print('BOARDS_AUDIT',json.dumps(audit_results))
