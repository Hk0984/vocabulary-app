"""Pure classification contract; master is the single repository JSON (never Sheets)."""
from __future__ import annotations
import json
import re
from functools import lru_cache
from pathlib import Path

BASE_HEADERS = ['id','source_id','question','choice1','choice2','choice3','choice4','answer','explanation']
EXTRA_HEADERS = ['period_codes','century_codes','area_codes','time_ranges']
HEADERS = BASE_HEADERS + EXTRA_HEADERS
MANAGEMENT_HEADERS = BASE_HEADERS + ['status','batch_id','created_at'] + EXTRA_HEADERS
PERIODS = {'prehistoric':(-100000,-3501),'ancient':(-3500,500),'medieval':(501,1500),'early_modern':(1501,1800),'modern':(1801,1918),'contemporary':(1919,100000)}
SPECIAL = {'unclassified','unspecified'}

def codes(value, optional=False):
    if not isinstance(value,str) or len(value)>24000:
        raise ValueError('分類コードが不正です')
    if not value and optional:
        return []
    result=value.split(';')
    if len(result)>2048 or any(not c or c.strip()!=c for c in result) or len(set(result))!=len(result):
        raise ValueError('分類コードの空要素・重複があります')
    return result

def validate_master(data):
    if not isinstance(data,dict) or data.get('schema_version')!='1.0' or not isinstance(data.get('regions'),list) or not 1<=len(data['regions'])<=4096:
        raise ValueError('地域マスターの形式が不正です')
    nodes={}
    for n in data['regions']:
        if isinstance(n,dict) and not isinstance(n.get('type'),str): raise ValueError('地域の種別が不正です')
        if not isinstance(n,dict) or not isinstance(n.get('code'),str) or not re.fullmatch(r'geo\.[a-z][a-z0-9_]*',n.get('code','')) or n['code'] in nodes or not isinstance(n.get('label'),str) or not n['label'].strip() or n.get('type') not in {'major_region','subregion','country_area','historical_region','composite_region'} or type(n.get('active')) is not bool or not isinstance(n.get('aliases'),list) or any(not isinstance(a,str) for a in n['aliases']) or not isinstance(n.get('parents'),list) or any(not isinstance(p,str) for p in n['parents']) or len(set(n['parents']))!=len(n['parents']):
            raise ValueError('地域マスターのノードが不正です')
        nodes[n['code']]=n
    pending={c:len(n['parents']) for c,n in nodes.items()};children={};depth={c:1 for c in nodes};queue=[c for c in nodes if not pending[c]]
    for code,node in nodes.items():
        for parent in node['parents']:
            if parent not in nodes: raise ValueError('地域マスターの親が存在しません')
            children.setdefault(parent,[]).append(code)
    for code in queue:
        for child in children.get(code,[]):
            depth[child]=max(depth[child],depth[code]+1)
            if depth[child]>64: raise ValueError('地域マスターの階層が深すぎます')
            pending[child]-=1
            if pending[child]==0:queue.append(child)
    if len(queue)!=len(nodes): raise ValueError('地域マスターが循環しています')
    return nodes

@lru_cache(maxsize=1)
def load_master():
    return validate_master(json.loads((Path(__file__).resolve().parent.parent/'history-regions.json').read_text(encoding='utf-8')))

def descendants(master,selected):
    result=set(selected)
    if any(c not in master for c in selected): raise ValueError('地域コードが存在しません')
    changed=True
    while changed:
        changed=False
        for n in master.values():
            if n['code'] not in result and any(p in result for p in n['parents']):
                result.add(n['code']); changed=True
    return result

def parse_ranges(value):
    if not isinstance(value,str) or len(value)>2048: raise ValueError('年代範囲が不正です')
    if not value: return []
    chunks=value.split(';')
    if len(chunks)>64: raise ValueError('年代範囲が多すぎます')
    ranges=[]
    for chunk in chunks:
        if not re.fullmatch(r'-?[1-9][0-9]*\.\.-?[1-9][0-9]*',chunk): raise ValueError('年代は0のないASCII整数で指定してください')
        a,b=map(int,chunk.split('..'))
        if abs(a)>100000 or abs(b)>100000 or a>b or a<0<b: raise ValueError('年代の範囲・順序・紀元前後の分割が不正です')
        ranges.append((a,b))
    ordered=sorted(ranges)
    if any(ordered[i][0]<=ordered[i-1][1] for i in range(1,len(ordered))): raise ValueError('年代範囲が重複しています')
    return ranges

def century_range(code):
    m=re.fullmatch(r'(ce|bce)_([0-9]{2,})',code)
    if not m: raise ValueError('世紀コードが不正です')
    n=int(m[2])
    if not 1<=n<=1000 or str(n).zfill(2)!=m[2]: raise ValueError('世紀の範囲・表記が不正です')
    return ((n-1)*100+1,n*100) if m[1]=='ce' else (-n*100,-(n-1)*100-1)

def defaults(row):
    return {**row,'period_codes':'unclassified','century_codes':'','area_codes':'unclassified','time_ranges':''}

def overlaps(a,b): return max(a[0],b[0])<=min(a[1],b[1])

def validate(row,master=None):
    master=load_master() if master is None else master
    periods=codes(row['period_codes']); centuries=codes(row['century_codes'],True); areas=codes(row['area_codes']); ranges=parse_ranges(row['time_ranges']); warnings=[]
    if any(p not in PERIODS and p not in SPECIAL for p in periods) or (set(periods)&SPECIAL and len(periods)!=1): raise ValueError('時代コードが不正です')
    cranges=[century_range(c) for c in centuries]
    if any(a not in master and a not in SPECIAL|{'global'} for a in areas) or (set(areas)&(SPECIAL|{'global'}) and len(areas)!=1): raise ValueError('地域コードが不正です')
    if set(periods)&SPECIAL and (ranges or centuries): raise ValueError('未分類・時代指定なしに年代や世紀は指定できません')
    if ranges:
        expected={p for p,bounds in PERIODS.items() if any(overlaps(r,bounds) for r in ranges)}
        if set(periods)!=expected: raise ValueError('年代と時代コードが一致しません')
        if centuries:
            expected_c=set()
            for a,b in ranges:
                for n in range((min(abs(a),abs(b))-1)//100+1,(max(abs(a),abs(b))-1)//100+2): expected_c.add(('bce_' if a<0 else 'ce_')+str(n).zfill(2))
            if set(centuries)!=expected_c: raise ValueError('年代と世紀コードが一致しません')
        if ranges!=sorted(ranges): warnings.append('年代範囲は昇順を推奨します')
    elif centuries:
        if any(not any(overlaps(c,PERIODS[p]) for c in cranges) for p in periods) or any(not any(overlaps(c,PERIODS[p]) for p in periods) for c in cranges): raise ValueError('時代と世紀が一致しません')
        if len(periods)>1 and len(centuries)>1 and any(sum(overlaps(c,PERIODS[p]) for p in periods)>1 for c in cranges): raise ValueError('複数時代・世紀の対応を年代範囲で指定してください')
    for area in areas:
        if area in master and any(p!=area and p in master and area in descendants(master,[p]) for p in areas): warnings.append('地域の親子が重複指定されています')
    return {'periods':periods,'centuries':centuries,'areas':areas,'ranges':ranges,'warnings':warnings}

def matches(row,filters,master=None):
    master=load_master() if master is None else master
    v=validate(row,master); periods=filters.get('periods',[]); centuries=filters.get('centuries',[]); areas=filters.get('areas',[])
    if not(periods or centuries or areas): return True
    if 'unclassified' in v['periods'] or 'unclassified' in v['areas']: return False
    if periods and not set(periods)&set(v['periods']): return False
    if centuries and not set(centuries)&set(v['centuries']): return False
    if areas and not descendants(master,areas)&set(v['areas']): return False
    if v['ranges']:
        pranges=[PERIODS[p] for p in periods if p in PERIODS] if periods else [(-100000,100000)]
        cranges=[century_range(c) for c in centuries] if centuries else [(-100000,100000)]
        if not any(max(r[0],p[0],c[0])<=min(r[1],p[1],c[1]) for r in v['ranges'] for p in pranges for c in cranges): return False
    return True
