#!/usr/bin/env node
// PCH Watch — GitHub Actions Scraper v4
// Strategy: Call Cloudflare Worker (bypasses pch.dz WAF)
// Author: Taibi Nadji — Personal project, no commercial purpose.

'use strict';

var https = require('https');
var fs    = require('fs');
var path  = require('path');

var CF_WORKER = 'https://aged-lake-d102.interpch1.workers.dev';

var SOURCES = [
  { id: 'appel-doffres', label: "Appels d'Offres" },
  { id: 'attribution',   label: 'Attributions'    },
  { id: 'infructuosite', label: 'Infructuosités'  },
  { id: 'consultations', label: 'Consultations'   },
];

function get(url, timeout) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      timeout:  timeout || 30000,
      headers: { 'User-Agent': 'PCH-Watch-Scraper/4.0', 'Accept': 'application/json' }
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    req.on('timeout', function(){ req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function fetchSource(sourceId, label) {
  var url = CF_WORKER + '?source=' + encodeURIComponent(sourceId);
  console.log('  Calling Worker for:', label);
  try {
    var raw = await get(url, 40000);
    var data = JSON.parse(raw);
    if (!data.ok) { console.log('  ⚠️  Worker error:', data.error || 'unknown'); return []; }
    console.log('  ✅', data.count, 'items');
    return data.items || [];
  } catch(e) {
    console.log('  ❌ Failed:', e.message.slice(0, 80));
    return [];
  }
}

async function pingWorker() {
  try {
    var raw = await get(CF_WORKER + '?source=ping', 10000);
    var d = JSON.parse(raw);
    console.log('Worker ping OK:', d.worker);
    return true;
  } catch(e) {
    console.log('Worker ping FAILED:', e.message);
    return false;
  }
}

function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

async function main() {
  console.log('PCH Watch Scraper v4 — ' + new Date().toISOString());
  console.log('Strategy: Cloudflare Worker → pch.dz');
  console.log('');

  var existing = { allItems: [] };
  try {
    var raw = fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8');
    existing = JSON.parse(raw);
    console.log('Loaded existing data:', existing.allItems.length, 'items');
  } catch(e) { console.log('Starting fresh'); }

  var workerOk = await pingWorker();
  if (!workerOk) {
    console.log('❌ Worker unreachable — keeping existing data');
    process.exit(0);
  }

  var allNew = [];
  for (var si = 0; si < SOURCES.length; si++) {
    var src = SOURCES[si];
    console.log('\n── Source:', src.label);
    var items = await fetchSource(src.id, src.label);
    items.forEach(function(i) {
      allNew.push({
        id:        i.id        || '',
        title:     (i.title    || '').trim().toUpperCase(),
        date:      i.date      || null,
        reference: i.reference || null,
        produit:   i.produit   || null,
        url:       i.url       || null,
        sourceId:  src.id,
      });
    });
    if (si < SOURCES.length - 1) await sleep(300);
  }

  console.log('\nFresh items fetched:', allNew.length);

  if (allNew.length === 0) {
    console.log('⚠️  No fresh items — keeping existing data');
    existing.scrapedAt = new Date().toISOString();
    existing.freshCount = 0;
    fs.writeFileSync(path.join(__dirname, '..', 'data.json'), JSON.stringify(existing, null, 2), 'utf8');
    process.exit(0);
  }

  var seenKeys = {};
  var merged = [];
  allNew.forEach(function(i) {
    var key = i.sourceId + '|' + i.id + '|' + (i.title||'').slice(0,40);
    if (!seenKeys[key] && i.title.length > 4) { seenKeys[key]=true; merged.push(i); }
  });
  (existing.allItems || []).forEach(function(i) {
    var key = i.sourceId + '|' + i.id + '|' + (i.title||'').slice(0,40);
    if (!seenKeys[key]) { seenKeys[key]=true; merged.push(i); }
  });

  merged.sort(function(a,b){
    var da=a.date?new Date(a.date):null, db=b.date?new Date(b.date):null;
    if(!da&&!db)return 0; if(!da)return 1; if(!db)return-1; return db-da;
  });

  var result = {
    scrapedAt:  new Date().toISOString(),
    freshCount: allNew.length,
    totalCount: merged.length,
    allItems:   merged.slice(0, 1000),
    sources:    {},
  };
  SOURCES.forEach(function(s){
    result.sources[s.id]=merged.filter(function(i){return i.sourceId===s.id;}).slice(0,200);
  });

  fs.writeFileSync(path.join(__dirname, '..', 'data.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n✅ data.json written —', result.allItems.length, 'total,', allNew.length, 'fresh');
}

main().catch(function(e){ console.error('Fatal:', e); process.exit(1); });
