"use strict";
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
function config(envName, suffix, port) {
  const raw=process.env[envName]; if(!raw) throw new Error("Missing "+envName);
  const url=new URL(raw);
  if(url.protocol!=="mysql:" || !url.hostname.endsWith(suffix) || Number(url.port||3306)!==port) throw new Error("Safety stop: unexpected endpoint for "+envName);
  const mode=(url.searchParams.get("ssl-mode")||"REQUIRED").toUpperCase();
  if(!["REQUIRED","VERIFY_IDENTITY"].includes(mode)) throw new Error("TLS is required");
  const database=decodeURIComponent(url.pathname.slice(1)); if(!database) throw new Error("Database name missing");
  return {host:url.hostname,port,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database,ssl:{rejectUnauthorized:true},connectTimeout:20000,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true};
}
function norm(v){if(Buffer.isBuffer(v))return {$binary:v.toString("base64")};if(v instanceof Date)return {$date:v.toISOString()};if(typeof v==="bigint")return v.toString();return v;}
async function inspect(label,cfg){
 const db=await mysql.createConnection(cfg);
 try{
  const [tables]=await db.query("SELECT TABLE_NAME name FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
  const result={label,database:cfg.database,tables:{}};
  for(const {name} of tables){
   const [[count]]=await db.query("SELECT COUNT(*) count FROM "+mysql.escapeId(name));
   if(name==="admin_security_events"){const [ddlRows]=await db.query("SHOW CREATE TABLE "+mysql.escapeId(name)); result.tables[name]={rowCount:String(count.count),ddl:ddlRows[0]["Create Table"],contentHashSkipped:"historical security events intentionally excluded"};continue;}
   const [ddlRows]=await db.query("SHOW CREATE TABLE "+mysql.escapeId(name));
   const ddl=ddlRows[0]["Create Table"];
   const [pk]=await db.query("SELECT COLUMN_NAME name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",[name]);
   const [cols]=await db.query("SELECT COLUMN_NAME name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",[name]);
   const order=(pk.length?pk:cols).map(x=>mysql.escapeId(x.name)).join(",");
   const [rows]=await db.query("SELECT * FROM "+mysql.escapeId(name)+" ORDER BY "+order);
   const hash=crypto.createHash("sha256");
   for(const row of rows){const clean={};for(const key of Object.keys(row))clean[key]=norm(row[key]);hash.update(JSON.stringify(clean));hash.update("\n");}
   result.tables[name]={rowCount:String(count.count),ddl,ddlSha256:crypto.createHash("sha256").update(ddl).digest("hex"),rowsSha256:hash.digest("hex"),primaryKey:pk.map(x=>x.name)};
  }
  return result;
 }finally{await db.end();}
}
(async()=>{
 const sourceCfg=config("SOURCE_DATABASE_URL",".db.enzonic.com",3306);
 const targetCfg=config("RESTORE_DATABASE_URL",".tidbcloud.com",4000);
 if(sourceCfg.host===targetCfg.host&&sourceCfg.database===targetCfg.database)throw new Error("Source and target must differ");
 console.log("[READ-ONLY] Hash comparison started; row values are never printed.");
 const [source,target]=await Promise.all([inspect("ENZONIC_SOURCE",sourceCfg),inspect("TIDB_TARGET",targetCfg)]);
 const names=[...new Set([...Object.keys(source.tables),...Object.keys(target.tables)])].sort();
 const comparison=names.map(table=>{const s=source.tables[table],t=target.tables[table];return {table,sourceRows:s?.rowCount??null,targetRows:t?.rowCount??null,rowHashesMatch:!!s?.rowsSha256&&!!t?.rowsSha256&&s.rowsSha256===t.rowsSha256,ddlHashesMatch:!!s?.ddlSha256&&!!t?.ddlSha256&&s.ddlSha256===t.ddlSha256,sourceOnly:!!s&&!t,targetOnly:!!t&&!s};});
 console.log(JSON.stringify({source,target,comparison},null,2));
 console.log("[READ-ONLY] Hash comparison completed; no data or schema changed.");
})().catch(e=>{console.error("[COMPARE FAILED]",e.message);process.exitCode=1;});
