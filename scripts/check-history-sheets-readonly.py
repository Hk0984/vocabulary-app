"""One-shot service-account connection check. Sheets readonly scope; GET methods only.

The Google SDK loads the explicitly supplied credential internally. No dotenv, Bot,
credential values, account identifiers or response bodies are printed or saved.
"""
import argparse
import json
import logging
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bot'))
from history_data import validate_table,reconcile_tables

SCOPES=['https://www.googleapis.com/auth/spreadsheets.readonly']

def inspect_sheet(service,spreadsheet_id,title,management,prefix,expect_empty):
    metadata=service.get(spreadsheetId=spreadsheet_id,fields='spreadsheetId,sheets.properties').execute()
    if metadata.get('spreadsheetId')!=spreadsheet_id or not any(s.get('properties',{}).get('title')==title for s in metadata.get('sheets',[])):
        raise ValueError('target_or_tab_mismatch')
    response=service.values().get(spreadsheetId=spreadsheet_id,range="'"+title.replace("'","''")+"'",valueRenderOption='FORMATTED_VALUE').execute()
    rows=validate_table(response.get('values',[]),management,prefix)
    count=sum(bool(row['id'])for row in rows)
    if expect_empty and count:raise ValueError('expected_header_only_sheet')
    return rows,{'connected':True,'header_valid':True,'columns':16 if management else 13,'questions':count,'tab':title}

def check_connections(service,management_id,public_id,title,prefix,expect_empty=True):
    if not management_id or not public_id or management_id==public_id:raise ValueError('separate_sheet_ids_required')
    if not re.fullmatch(r'hv1_[a-z][a-z0-9_]{1,40}_',prefix):raise ValueError('invalid_id_prefix')
    if not isinstance(title,str) or not title.strip():raise ValueError('tab_required')
    private,private_report=inspect_sheet(service,management_id,title,True,prefix,expect_empty)
    public,public_report=inspect_sheet(service,public_id,title,False,prefix,expect_empty)
    aligned=reconcile_tables(private,public)
    return {'authentication':'existing-service-account','sheets_scope':'readonly','sheets_methods':['GET'],
            'management':private_report,'public':public_report,'alignment':aligned,'production_writes':0}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials-file',required=True)
    parser.add_argument('--management-id',required=True);parser.add_argument('--public-id',required=True)
    parser.add_argument('--tab',default='history_questions');parser.add_argument('--prefix',required=True)
    parser.add_argument('--report',required=True)
    args=parser.parse_args()
    target=Path(args.report)
    if target.exists():parser.exit(1,'Report already exists; choose a new path.\n')
    logging.disable(logging.CRITICAL)
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        credentials=Credentials.from_service_account_file(args.credentials_file,scopes=SCOPES)
        if list(credentials.scopes or [])!=SCOPES:raise ValueError('readonly_scope_required')
        service=build('sheets','v4',credentials=credentials,cache_discovery=False).spreadsheets()
        result=check_connections(service,args.management_id,args.public_id,args.tab,args.prefix)
    except Exception as error:
        status=getattr(getattr(error,'resp',None),'status',None)
        result={'connected':False,'stage':'readonly_connection_or_validation','error_type':type(error).__name__,
                'http_status':status if isinstance(status,int)else None,'credentials_and_response_contents':'withheld','production_writes':0}
        code=1
    else:code=0
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('x',encoding='utf-8')as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    print(json.dumps(result,ensure_ascii=False))
    return code
if __name__=='__main__':sys.exit(main())
