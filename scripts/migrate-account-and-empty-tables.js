"use strict";
const mysql = require("mysql2/promise");
const crypto = require("node:crypto");

function parseConfig(envName, suffix, port, expectedDb) {
  const raw = process.env[envName];
  if (!raw) throw new Error("Missing " + envName);
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !url.hostname.endsWith(suffix) || Number(url.port || 3306) !== port) {
    throw new Error("Safety stop: unexpected database endpoint for " + envName);
  }
  const mode = (url.searchParams.get("ssl-mode") || "REQUIRED").toUpperCase();
  if (!["REQUIRED", "VERIFY_IDENTITY"].includes(mode)) throw new Error("TLS must be required.");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== expectedDb) throw new Error("Safety stop: unexpected database name for " + envName);
  return {host:url.hostname,port,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database,ssl:{rejectUnauthorized:true},connectTimeout:20000,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true};
}
const TABLES = ["users","comments","ai_feedback","copyright_reports"];
const qi = mysql.escapeId;
function clean(v) {
  if (Buffer.isBuffer(v)) return {$binary:v.toString("base64")};
  if (v instanceof Date) return {$date:v.toISOString()};
  if (typeof v === "bigint") return v.toString();
  return v;
}
function digest(rows) {
  const h=crypto.createHash("sha256");
  for (const row of rows) {
    const o={}; for (const k of Object.keys(row)) o[k]=clean(row[k]);
    h.update(JSON.stringify(o)); h.update("\n");
  }
  return h.digest("hex");
}
async function columns(db, table) {
  const [rows]=await db.query(
    "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",[table]);
  return rows;
}
async function rows(db, table, cols) {
  const order=cols.some(c=>c.COLUMN_KEY==="PRI")?"":"";
  const [pk]=await db.query("SELECT COLUMN_NAME FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION",[table]);
  const sort=pk.length?pk.map(x=>qi(x.COLUMN_NAME)).join(","):"1";
  const [data]=await db.query("SELECT * FROM "+qi(table)+" ORDER BY "+sort);
  return data;
}
async function main() {
  const apply=String(process.env.APPLY_MIGRATION||"").toLowerCase()==="true";
  const sourceCfg=parseConfig("SOURCE_DATABASE_URL",".db.enzonic.com",3306,"main");
  const targetCfg=parseConfig("RESTORE_DATABASE_URL",".tidbcloud.com",4000,"noadframe");
  if(sourceCfg.host===targetCfg.host) throw new Error("Source and target hosts must differ.");
  const source=await mysql.createConnection(sourceCfg);
  const target=await mysql.createConnection(targetCfg);
  try {
    const plan=[];
    for (const table of TABLES) {
      const sc=await columns(source,table), tc=await columns(target,table);
      if (!sc.length||!tc.length) throw new Error("Missing required table: "+table);
      const sourceShape=sc.map(x=>[x.COLUMN_NAME,x.COLUMN_TYPE,x.IS_NULLABLE,x.EXTRA]);
      const targetShape=tc.map(x=>[x.COLUMN_NAME,x.COLUMN_TYPE,x.IS_NULLABLE,x.EXTRA]);
      if (JSON.stringify(sourceShape)!==JSON.stringify(targetShape)) { console.error("[SCHEMA METADATA MISMATCH]", JSON.stringify({table,sourceShape,targetShape})); throw new Error("Schema mismatch; stopped safely at "+table); }
      const sr=await rows(source,table,sc), tr=await rows(target,table,tc);
      const sourceHash=digest(sr), targetHash=digest(tr);
      if (tr.length && sourceHash!==targetHash) throw new Error("Target table is not empty and differs from source; stopped at "+table);
      plan.push({table,sourceRows:sr.length,targetRows:tr.length,alreadyMatching:tr.length>0&&sourceHash===targetHash,
        action:tr.length===0&&sr.length>0?"COPY_MISSING_ROWS":tr.length===0?"NO_ROWS_TO_COPY":"ALREADY_MATCHING",
        sourceHash,targetHash,sourceRowsData:sr});
    }
    console.log(JSON.stringify({mode:apply?"APPLY":"DRY_RUN",tables:plan.map(({sourceRowsData,...x})=>x),
      excludedTables:["admin_security_events"],note:"No historical admin security events are copied. Source remains untouched."},null,2));
    if (!apply) { console.log("DRY RUN ONLY. No rows changed."); return; }
    for (const item of plan) {
      if (item.action!=="COPY_MISSING_ROWS") continue;
      const table=item.table, data=item.sourceRowsData;
      const names=Object.keys(data[0]);
      const sql="INSERT INTO "+qi(table)+" ("+names.map(qi).join(",")+") VALUES ("+names.map(()=>"?").join(",")+")";
      await target.beginTransaction();
      try {
        for (const row of data) await target.execute(sql,names.map(n=>row[n]));
        await target.commit();
      } catch(e) { await target.rollback(); throw e; }
      console.log("Copied rows:",table,data.length);
    }
    for (const table of TABLES) {
      const sc=await columns(source,table), tc=await columns(target,table);
      const sr=await rows(source,table,sc), tr=await rows(target,table,tc);
      if (sr.length!==tr.length || digest(sr)!==digest(tr)) throw new Error("Post-copy verification failed for "+table);
    }
    console.log("Migration verified: all selected table rows match. Source database was not modified.");
  } finally { await source.end(); await target.end(); }
}
main().catch(e=>{console.error("[SAFE DATA MIGRATION FAILED]",e.message);process.exitCode=1;});
