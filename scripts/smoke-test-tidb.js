"use strict";
const mysql = require("mysql2/promise");

function config() {
  const raw=process.env.RESTORE_DATABASE_URL;
  if(!raw) throw new Error("Missing RESTORE_DATABASE_URL.");
  const u=new URL(raw);
  if(u.protocol!=="mysql:" || !u.hostname.endsWith(".tidbcloud.com") || Number(u.port)!==4000) {
    throw new Error("Safety stop: expected TiDB Cloud on port 4000.");
  }
  const sslMode=(u.searchParams.get("ssl-mode")||"REQUIRED").toUpperCase();
  if(!["REQUIRED","VERIFY_IDENTITY"].includes(sslMode)) {
    throw new Error("Safety stop: TiDB TLS must be REQUIRED or VERIFY_IDENTITY.");
  }
  const db=decodeURIComponent(u.pathname.slice(1));
  if(db!=="noadframe") throw new Error("Safety stop: unexpected database name.");
  return {host:u.hostname,port:4000,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:db,ssl:{rejectUnauthorized:true},connectTimeout:20000,dateStrings:true,
    supportBigNumbers:true,bigNumberStrings:true};
}
async function main(){
  const db=await mysql.createConnection(config());
  try{
    await db.query("SET SESSION TRANSACTION READ ONLY");
    const [[identity]]=await db.query("SELECT DATABASE() AS databaseName, VERSION() AS serverVersion");
    if(identity.databaseName!=="noadframe" || !String(identity.serverVersion).includes("TiDB")) throw new Error("Connected to unexpected database engine or schema.");
    const expected=["movies","site_banner","site_banners","site_home_sections","users","comments","ai_feedback","copyright_reports","admin_security_events"];
    const [found]=await db.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_TYPE='BASE TABLE'");
    const names=new Set(found.map(x=>x.TABLE_NAME));
    const missing=expected.filter(x=>!names.has(x));
    if(missing.length) throw new Error("Missing application tables: "+missing.join(", "));
    const counts={};
    for(const table of expected){
      const [[row]]=await db.query("SELECT COUNT(*) AS total FROM `"+table+"`");
      counts[table]=Number(row.total);
    }
    if(counts.movies<1) throw new Error("Movie catalogue is unexpectedly empty.");
    if(counts.site_banner<1 || counts.site_banners<1 || counts.site_home_sections<1) throw new Error("Homepage banner/section data is unexpectedly empty.");
    if(counts.users<1) throw new Error("Migrated account record is missing.");
    const [fks]=await db.query("SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND referenced_table_name IS NOT NULL AND table_name='comments' ORDER BY COLUMN_NAME");
    if(fks.length!==2 || !fks.some(x=>x.COLUMN_NAME==="user_id"&&x.REFERENCED_TABLE_NAME==="users") || !fks.some(x=>x.COLUMN_NAME==="movie_id"&&x.REFERENCED_TABLE_NAME==="movies")) {
      throw new Error("Expected comments foreign keys are missing or incorrect.");
    }
    const blobChecks={};
    for(const table of ["site_banner","site_banners"]){
      const [cols]=await db.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?",[table]);
      if(cols.some(c=>c.COLUMN_NAME==="image_bytes")){
        const [[row]]=await db.query("SELECT COUNT(*) AS rows_total, COALESCE(SUM(OCTET_LENGTH(image_bytes)),0) AS bytes_total FROM `"+table+"` WHERE image_bytes IS NOT NULL");
        blobChecks[table]={rowsWithImageBytes:Number(row.rows_total),totalBytes:Number(row.bytes_total)};
      }
    }
    console.log(JSON.stringify({status:"PASS",mode:"READ_ONLY",database:identity.databaseName,serverVersion:identity.serverVersion,tableCounts:counts,commentsForeignKeys:fks.length,binaryImageChecks:blobChecks,mutationsPerformed:false},null,2));
  } finally { await db.end(); }
}
main().catch(error=>{console.error("[TIDB READ-ONLY SMOKE TEST FAILED]",error.message);process.exitCode=1;});
