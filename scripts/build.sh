#!/bin/bash
set -euo pipefail
mkdir -p dist/server
python3 -B - <<'PY'
import base64,json
files={'/index.html':('assets/index.html','text/html; charset=utf-8')}
files['/recipe-markdown.js']=('assets/recipe-markdown.js','text/javascript; charset=utf-8')
files['/privacy.html']=('assets/privacy.html','text/html; charset=utf-8')
files['/config.js']=('assets/config.js','text/javascript; charset=utf-8')
files['/sync.js']=('assets/sync.js','text/javascript; charset=utf-8')
files['/meal-planner.js']=('assets/meal-planner.js','text/javascript; charset=utf-8')
files['/meal-planner.css']=('assets/meal-planner.css','text/css; charset=utf-8')
files['/vendor/pdf-lib.min.js']=('assets/vendor/pdf-lib.min.js','text/javascript; charset=utf-8')
assets={url:{'data':base64.b64encode(open(path,'rb').read()).decode(),'type':kind} for url,(path,kind) in files.items()}
source=open('worker/template.js').read().replace('__ASSETS__',json.dumps(assets,separators=(',',':')))
open('dist/server/index.js','w').write(source)
PY
