import { readFileSync } from 'node:fs'
import { validate } from '/Users/thinhtran/workspace/self-learning/weekly-reviews/codegen/schema.mjs'
const R='/Users/thinhtran/workspace/self-learning/weekly-reviews'
const gold=JSON.parse(readFileSync(R+'/json/2026-11-07.json','utf8'))
const prev=JSON.parse(readFileSync(R+'/json/2026-10-31.json','utf8'))
const data=JSON.parse(readFileSync(R+'/data/2026-11-07.json','utf8'))
for (const f of process.argv.slice(2)) {
  const part=JSON.parse(readFileSync(f,'utf8'))
  const r={...gold}
  for (const k of ['workedOn','reviewing','verdict','shoutouts','improved','lacked']) if (part[k]!==undefined) r[k]=part[k]
  const errs=validate(r,'2026-11-07.json',prev,data)
  console.log(f.split('/').slice(-2).join('/'), errs.length?errs.join(' | '):'valid')
}
