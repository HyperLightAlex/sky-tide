"""Validate the shipped board GLBs without needing Blender or third-party modules."""
import json
import math
import struct
from pathlib import Path

BASE=Path(__file__).resolve().parents[2]


def validate(path):
    raw=path.read_bytes()
    magic,version,size=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and size==len(raw)
    json_len,json_type=struct.unpack_from('<II',raw,12)
    assert json_type==0x4e4f534a
    doc=json.loads(raw[20:20+json_len])
    bin_len,bin_type=struct.unpack_from('<II',raw,20+json_len)
    assert bin_type==0x004e4942
    data=raw[28+json_len:28+json_len+bin_len]
    assert len(data)==bin_len
    assert not doc.get('images') and not doc.get('textures')
    assert not any('uri' in b for b in doc.get('buffers',[]))
    assert not doc.get('cameras')
    assert 'KHR_lights_punctual' not in doc.get('extensions',{})
    components={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
    widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

    def accessor(index):
        ac=doc['accessors'][index];bv=doc['bufferViews'][ac['bufferView']]
        code,n=components[ac['componentType']];width=widths[ac['type']]
        start=bv.get('byteOffset',0)+ac.get('byteOffset',0)
        stride=bv.get('byteStride',width*n)
        return [struct.unpack_from('<'+code*width,data,start+i*stride) for i in range(ac['count'])]

    triangles=0;minarea=1.0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode',4)==4
            points=accessor(primitive['attributes']['POSITION'])
            normals=accessor(primitive['attributes']['NORMAL'])
            assert all(math.isfinite(c) for p in points+normals for c in p)
            assert all(abs(sum(c*c for c in n)-1)<1e-4 for n in normals)
            indices=[i[0] for i in accessor(primitive['indices'])]
            assert len(indices)%3==0 and max(indices)<len(points)
            triangles+=len(indices)//3
            for i in range(0,len(indices),3):
                a,b,c=[points[indices[i+j]] for j in range(3)]
                u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
                cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                area=math.sqrt(sum(c*c for c in cross))*.5
                minarea=min(minarea,area)
                assert area>1e-12,(mesh['name'],'degenerate triangle',area)
    names={n['name']:i for i,n in enumerate(doc['nodes'])}
    assert len(names)==len(doc['nodes'])

    def descendants(index):
        found={index}
        for child in doc['nodes'][index].get('children',[]):found|=descendants(child)
        return found

    front=doc['nodes'][names['FootHold_Front']]
    rear=doc['nodes'][names['FootHold_Rear']]
    assert not descendants(names['FootHold_Front'])&descendants(names['FootHold_Rear'])
    for hold,foot,z in [(front,'L',-.32),(rear,'R',.32)]:
        assert hold['extras']['role']=='foothold' and hold['extras']['foot']==foot
        assert abs(hold['extras']['footbedHeight']-.014)<1e-8
        assert abs(hold['translation'][2]-z)<1e-6
        assert abs(hold['translation'][1])<1e-6
        assert len(hold.get('children',[]))>=3
        assert all('mesh' in doc['nodes'][i] for i in hold['children'])
    for name in ['Wake_Left','Wake_Right','Fin_Left','Fin_Right']:assert name in names
    lights=[n for n in doc['nodes'] if n.get('extras',{}).get('role')=='trapar']
    assert len(lights)>=3
    for mat in doc['materials']:
        assert mat['name'].startswith('cel_')
        assert mat.get('pbrMetallicRoughness',{}).get('metallicFactor',1)==0
        assert not any(mat.get('emissiveFactor',[0,0,0]))
    return {'file':str(path.relative_to(BASE)),'bytes':len(raw),'triangles':triangles,
            'runtime_meshes':len(doc['meshes']),'runtime_nodes':len(doc['nodes']),
            'minimum_triangle_area_m2':minarea,'unit_normals':True,'no_degenerate_triangles':True,
            'independent_foothold_hierarchies':True,'footbed_height_m':.014,
            'trapar_surfaces':len(lights),'external_dependencies':False,'lights_or_cameras':False}


if __name__=='__main__':
    results={name:validate(BASE/'assets/models'/f'{name}.glb') for name in ['skipper','kestrel']}
    output=BASE/'art/models/production/boards-audit.json'
    audit=json.loads(output.read_text())
    for name,validation in results.items():audit[name]['export_validation']=validation
    output.write_text(json.dumps(audit,indent=2)+'\n')
    print(json.dumps(results,indent=2))
