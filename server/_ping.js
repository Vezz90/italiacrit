const fs=require('fs');
fs.readFileSync('.env.local','utf8').split('\n').forEach(l=>{const m=l.match(/^([^#=\s]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')});
const {createClient}=require('@supabase/supabase-js');const ws=require('ws');
const sb=createClient('https://aqqsstsbgpapzoxllosh.supabase.co',process.env.SUPABASE_SECRET,{realtime:{transport:ws}});
(async()=>{const t=Date.now();const q=await sb.from('pro_races').select('pcs_race_slug').limit(1);console.log(q.error?('ERRORE: '+q.error.message):('ok in '+(Date.now()-t)+' ms'))})();
