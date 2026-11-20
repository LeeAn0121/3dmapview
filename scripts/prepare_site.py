"""Read an XLSX locally and download public floor plans. No workbook data is sent online."""
import argparse
import collections
import json
import os
import posixpath
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'x': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
EMBED = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
BASE = 'https://www.cmcseoul.or.kr'

def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '30', url, '-o', str(target)], check=True)

def rels(z, part):
    name = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
    if name not in z.namelist(): return {}
    return {r.get('Id'): posixpath.normpath(posixpath.join(posixpath.dirname(part), r.get('Target'))) for r in ET.fromstring(z.read(name)) if r.get('TargetMode') != 'External'}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('workbook'); args = parser.parse_args()
    out = Path('local-data'); (out/'photos').mkdir(parents=True, exist_ok=True)
    fetch(BASE+'/api/hospitalguide/lookaround?dataType=front', out/'official-places.json')
    places = json.loads((out/'official-places.json').read_text())
    buildings = [{'id': p['placeCd'], 'name': p['placeNm']} for p in places if p.get('depth') == 1]
    floors=[]
    for p in places:
        if p.get('depth') != 2: continue
        children = [q for q in places if q.get('parentPlaceCd') == p['placeCd'] and q.get('depth') == 3]
        if not children: continue
        image = out/'maps'/(p['placeCd']+'.png')
        url=BASE+'/api/attach/view/lookAround/'+children[0]['placeCd']+'/lookAroundImage/'
        try:
            fetch(url, image)
            if image.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('not a PNG')
            image_path='/local-data/maps/'+image.name
        except (subprocess.CalledProcessError, ValueError): image_path=None
        order = -int(p['placeNm'][1:]) if p['placeNm'].startswith('B') else int(p['placeNm'].rstrip('F'))
        floors.append({'id':p['placeCd'], 'buildingId':p['parentPlaceCd'], 'name':p['placeNm'], 'order':order,
                       'image':image_path, 'sourceUrl':url, 'imageNote':'공식 사이트의 부서 강조 이미지입니다. 단말 위치를 의미하지 않습니다.'})
    with zipfile.ZipFile(args.workbook) as z:
        strings = [''.join(t.text or '' for t in si.findall('.//s:t', NS)) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        workbook=ET.fromstring(z.read('xl/workbook.xml')); wr=rels(z,'xl/workbook.xml'); sheets=[]
        for sh in workbook.find('s:sheets',NS):
            part=wr[sh.get(RID)]; root=ET.fromstring(z.read(part)); rows=[]
            for row in root.findall('.//s:sheetData/s:row',NS):
                values={}
                for c in row:
                    v=c.find('s:v',NS); value=v.text if v is not None else ''
                    if c.get('t')=='s' and value: value=strings[int(value)]
                    elif c.get('t')=='inlineStr': value=''.join(t.text or '' for t in c.findall('.//s:t',NS))
                    if value: values[re.sub(r'\d','',c.get('r'))]=value
                rows.append((int(row.get('r')),values))
            photos=collections.defaultdict(list)
            sr=rels(z,part)
            for drawing in root.findall('s:drawing',NS):
                dp=sr[drawing.get(RID)]; dr=rels(z,dp)
                for anchor in ET.fromstring(z.read(dp)):
                    start=anchor.find('x:from/x:row',NS); blip=anchor.find('.//a:blip',NS)
                    if start is None or blip is None: continue
                    media=dr.get(blip.get(EMBED))
                    if not media: continue
                    target=out/'photos'/posixpath.basename(media); target.write_bytes(z.read(media))
                    photos[int(start.text)+1].append('/local-data/photos/'+target.name)
            sheets.append({'name':sh.get('name'),'rows':rows,'photos':photos})
        devices=[]; group=''
        for rownum, row in sheets[0]['rows']:
            if rownum<3: continue
            group=row.get('A') or group
            if not row.get('B') or not row.get('C'): continue
            building=next((b for b in buildings if b['name'] in group),None)
            match=re.search(r'(B\d+|\d+F|\d+층)',group)
            floorname=match.group(1).replace('층','F') if match else None
            floor=next((f for f in floors if building and f['buildingId']==building['id'] and f['name']==floorname),None)
            devices.append({'id':'terminal-'+str(rownum),'name':row['C'],'location':row['B'],'kind':'셋톱박스',
                            'buildingId':building['id'] if building else None,'floorId':floor['id'] if floor else None,
                            'ip':row.get('D',''),'switch':row.get('E',''),'port':row.get('F',''),
                            'subnet':row.get('I',''),'gateway':row.get('J',''),'dns':row.get('K',''),
                            'position':None,'sourceSheet':sheets[0]['name'],'sourceRow':rownum,'photos':[],'notes':''})
        # Sheet drawing anchors identify the installation group, not exact map coordinates.
        for sheet in sheets[2:]:
            building=next((b for b in buildings if b['name'] in sheet['name']),None)
            match=re.search(r'(지하\s*\d+|\d+)층',sheet['name'])
            floorname=('B'+re.sub(r'\D','',match.group(1)) if '지하' in match.group(1) else match.group(1)+'F') if match else None
            floor=next((f for f in floors if building and f['buildingId']==building['id'] and f['name']==floorname),None)
            for rn, row in sheet['rows']:
                title=row.get('A',''); names=re.sub(r'\(\d+\)','',title.split('\n-')[0]); names=re.sub(r'\s','',names)
                candidates=[d for d in devices if d['floorId']==(floor['id'] if floor else None) and re.sub(r'\s','',d['location'])==names]
                photos=sheet['photos'].get(rn,[])
                for d in candidates:
                    d['photos']=photos; d['notes']=title; d['photoMatch']='설치 장소 그룹의 참고 사진 · 개별 단말 식별 미확정'
                if '미디어월' in sheet['name']:
                    devices.append({'id':'mediawall-'+str(rn),'name':'미디어월 '+str(rn),'location':title,'kind':'미디어월',
                                    'buildingId':building['id'] if building else None,'floorId':floor['id'] if floor else None,
                                    'ip':'','switch':'','port':'','position':None,'photos':photos,'notes':'단말 설정표에 IP 정보 없음',
                                    'photoMatch':'설치 장소 시트의 참고 사진','sourceSheet':sheet['name'],'sourceRow':rn})
    site={'version':1,'id':'seoul-st-mary','name':'서울성모병원','buildings':buildings,'floors':floors,'devices':devices,
          'sources':[{'name':'서울성모병원 병원둘러보기','url':BASE+'/page/hospitalguide/lookaround'},
                     {'name':Path(args.workbook).name}], 'importedAt':'2026-11-20',
          'warnings':['공식 안내도와 현장 엑셀의 부서 명칭·배치가 다를 수 있습니다.','감마나이프센터의 건물·층은 확인이 필요합니다.']}
    (out/'site.json').write_text(json.dumps(site,ensure_ascii=False,indent=2))
    print(json.dumps({'floors':len(floors),'terminals':len(devices),'withPhotos':sum(bool(d['photos']) for d in devices),'positioned':0},ensure_ascii=False))

if __name__=='__main__': main()
