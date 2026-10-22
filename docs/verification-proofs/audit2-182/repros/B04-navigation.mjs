// New bounded synthetic route reproduction observed during this audit.
// Run this file with Node from any working directory.
import { createAppServer } from '../../../../server/index.mjs';
import { readFile } from 'node:fs/promises';
const html=await readFile(new URL('../../../../public/manual-backups.html',import.meta.url),'utf8');
const link=/<a href="([^"]+)" data-jm-i18n="Ouvrir la messagerie"/.exec(html)?.[1];
const server=createAppServer({
 entryHandler:async()=>false,
 chatHandler:async(req,res)=>{
  if(req.url!=='/admin/messages')return false;
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end('synthetic canonical chat');return true;
 }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 const base=`http://127.0.0.1:${server.address().port}`;
 const bad=await fetch(base+link),good=await fetch(base+'/admin/messages');
 console.log(JSON.stringify({
 scope:'new_local_synthetic_route_reproduction_no_backup_execution',
 node:process.version,source:'public/manual-backups.html:12',link,
 linkStatus:bad.status,canonicalPath:'/admin/messages',canonicalStatus:good.status,externalRequests:0
 }));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
