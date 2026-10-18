const fs=require('fs');
fs.readFileSync('.env.local','utf8').split('\n').forEach(l=>{const m=l.match(/^([^#=\s]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')});
const {createClient}=require('@supabase/supabase-js');const ws=require('ws');
const sb=createClient('https://aqqsstsbgpapzoxllosh.supabase.co',process.env.SUPABASE_SECRET,{realtime:{transport:ws}});
const OK=new Set('sakarias-koller-loland lawrence-warbasse rasmus-sojbergpedersen bjoern-koerdt soren-waerenskjold kelland-brien soren-kragh-andersen matheo-vercher jefferson-cepeda-hernandez julen-arriola-bengoa-beitia aleksey-lutsenko sven-erik-bystrom edward-irl-dunbar torstein-traeen tiril-jorgensen alexander-edmondson kamilla-aasebo christopher-froome yelizaveta-kozakova nikol-plosaj karolina-kolkowicz kyra-chreichmuth jana-czinkarova xaverine-nirere alfred-wright nicolas-scarpelli'.split(' '));
(async()=>{
 const plan=JSON.parse(fs.readFileSync('pcs-link-or-create-plan.json','utf8'));
 const span=JSON.parse(fs.readFileSync('pcs-span-ids.json','utf8'));let tot=0,n=0;
 for(const a of plan.ambiguous){ if(!OK.has(a.slug)||a.ids.length!==1)continue; const id=a.ids[0];
  const ex=(await sb.from('entity_overrides').select('new_value').eq('entity_type','atleta').eq('entity_id',id).eq('field','pcs_slug')).data[0];
  const own=(await sb.from('entity_overrides').select('entity_id').eq('entity_type','atleta').eq('field','pcs_slug').eq('new_value',a.slug)).data[0];
  if((ex&&ex.new_value!==a.slug)||(own&&own.entity_id!==id)){console.log('salto',a.slug);continue}
  await sb.from('entity_overrides').upsert({entity_type:'atleta',entity_id:id,field:'pcs_slug',new_value:a.slug,edited_by:null},{onConflict:'entity_type,entity_id,field'});
  await sb.from('entity_overrides').delete().eq('entity_type','atleta').eq('entity_id',id).eq('field','pcs_not_found');
  if(!span.includes(id))span.push(id);n++;console.log('slug',a.slug,'->',id)}
 fs.writeFileSync('pcs-span-ids.json',JSON.stringify(span));console.log('slug assegnati',n);
 const races=(await sb.from('pro_races').select('pcs_race_slug,season')).data;
 for(const a of plan.ambiguous){ if(!OK.has(a.slug)||a.ids.length!==1)continue;
  for(const x of races){const u=await sb.from('pcs_race_full_results').update({atleta_id:a.ids[0]}).eq('pcs_race_slug',x.pcs_race_slug).eq('season',x.season).eq('pcs_slug',a.slug).is('atleta_id',null).select('id');tot+=(u.data||[]).length}}
 console.log('collegati righe',tot);
})();
