import json

with open('api_data.json', encoding='utf-8-sig') as f:
    data = json.load(f)

print('nome_link:', data.get('nome_link'))
grupos = data.get('grupos', [])
print('grupos len:', len(grupos))

for i, g in enumerate(grupos):
    print(f'Grupo {i}: {g.get(" nome\)}')
 for l in g.get('linhas', []):
 print(f' ID: {l.get(\id\)} | Codigo: {l.get(\codigo\)} | Nome: {l.get(\nome\)} | Sentido: {l.get(\sentido\)}')

fld = data.get('full_lines_data')
if fld:
 print('--- full_lines_data ---')
 if isinstance(fld, dict):
 for k, v in fld.items():
 if isinstance(v, dict):
 print(f'Linha {k}: {v.get(\nome\)} | Sentido: {v.get(\sentido\)} | Pontos: {len(v.get(\pontos\, []))}')
