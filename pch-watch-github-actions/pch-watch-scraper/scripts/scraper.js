#!/usr/bin/env node
// PCH Watch — GitHub Actions Scraper
// Runs on GitHub's servers (ASN 36459) which are NOT blocked by pch.dz WAF.
// Saves results to data.json which is served via raw.githubusercontent.com.
// Author: Taibi Nadji — Personal project, no commercial purpose.

'use strict';

var https = require('https');
var zlib  = require('zlib');
var fs    = require('fs');
var path  = require('path');

var SOURCES = [
  { id: 'appel-doffres', url: 'https://www.pch.dz/appel-doffres',  label: "Appels d'Offres" },
  { id: 'attribution',   url: 'https://www.pch.dz/attribution',    label: 'Attributions'     },
  { id: 'infructuosite', url: 'https://www.pch.dz/infructuosite',  label: 'Infructuosités'   },
  { id: 'consultations', url: 'https://www.pch.dz/consultations',  label: 'Consultations'    },
];

var MAX_PAGES = 5;

// ── HTTP GET ─────────────────────────────────────────────────────
function get(url, timeout) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: timeout || 30000,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-DZ,fr;q=0.9,ar;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control':   'no-cache',
        'Pragma':          'no-cache',
        'Referer':         'https://www.pch.dz/',
      }
    };
    var req = https.request(opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location, timeout).then(resolve).catch(reject);
        return;
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buf = Buffer.concat(chunks);
        var enc = (res.headers['content-encoding'] || '').toLowerCase();
        function done(b) { resolve(b.toString('utf8')); }
        if      (enc === 'gzip')    zlib.gunzip(buf, function(e,d){ done(e ? buf : d); });
        else if (enc === 'deflate') zlib.inflate(buf, function(e,d){ done(e ? buf : d); });
        else if (enc === 'br')      zlib.brotliDecompress(buf, function(e,d){ done(e ? buf : d); });
        else                        done(buf);
      });
    });
    req.on('timeout', function(){ req.destroy(); reject(new Error('Timeout: ' + url)); });
    req.on('error', reject);
    req.end();
  });
}

// ── Parser ────────────────────────────────────────────────────────
function parseItems(html, sourceId, seen) {
  var items;
  items = stratLire(html, sourceId, seen);    if (items.length) return items;
  items = stratArticle(html, sourceId, seen); if (items.length) return items;
  items = stratViews(html, sourceId, seen);   if (items.length) return items;
  items = stratH2(html, sourceId, seen);      if (items.length) return items;
  return stratLinks(html, sourceId, seen);
}

function stratLire(html, sourceId, seen) {
  var items=[], lower=html.toLowerCase(), kw='lire la suite', pos=0, prev=0, lim=0;
  while(lim++<100){var ki=lower.indexOf(kw,pos);if(ki<0)break;var it=fromBlock(html.slice(Math.max(prev,ki-2500),ki+50),sourceId,seen);if(it)items.push(it);prev=ki+50;pos=ki+kw.length;}
  return items;
}
function stratArticle(html, sourceId, seen) {
  var items=[], re=/<article[\s>][\s\S]*?<\/article>/gi, m;
  while((m=re.exec(html))!==null){var it=fromBlock(m[0],sourceId,seen);if(it)items.push(it);}
  return items;
}
function stratViews(html, sourceId, seen) {
  var items=[], parts=html.split(/class="[^"]*views-row/gi);
  for(var i=1;i<parts.length;i++){var it=fromBlock(parts[i].slice(0,2500),sourceId,seen);if(it)items.push(it);}
  return items;
}
function stratH2(html, sourceId, seen) {
  var items=[], re=/<h[23]\b/gi, m;
  while((m=re.exec(html))!==null){var it=fromBlock(html.slice(m.index,m.index+600),sourceId,seen);if(it)items.push(it);}
  return items;
}
function stratLinks(html, sourceId, seen) {
  var items=[], re=/<a\s[^>]*href="([^"#?]+)"[^>]*>([\s\S]{8,400}?)<\/a>/gi, m;
  while((m=re.exec(html))!==null){var href=m[1].trim(),t=strip(m[2]).toUpperCase();if(!isTender(t)||t==='LIRE LA SUITE')continue;var slug=sOf(href);if(seen[slug])continue;seen[slug]=true;items.push(buildItem(slug,t,xDate(html.slice(Math.max(0,m.index-400),m.index+500)),href,sourceId));}
  return items;
}

function fromBlock(block, sourceId, seen) {
  var best=null;
  var h2pos=block.search(/<h[23]\b/i);
  if(h2pos>=0){var am=/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block.slice(h2pos,h2pos+700));if(am){var t=strip(am[2]).toUpperCase();if(t.length>=8&&isTender(t))best={href:am[1].trim(),title:t};}}
  var lr=/<a\s[^>]*href="([^"#?]+)"[^>]*>([\s\S]{8,500}?)<\/a>/gi,lm;
  while((lm=lr.exec(block))!==null){var lt=strip(lm[2]).toUpperCase();if(!isTender(lt)||lt==='LIRE LA SUITE'||lt.length<8)continue;if(!best||lt.length>best.title.length)best={href:lm[1].trim(),title:lt};}
  if(!best)return null;
  var slug=sOf(best.href);if(seen[slug])return null;seen[slug]=true;
  var endH2=block.search(/<\/h[23]>/i);
  return buildItem(slug,best.title,xDate(endH2>=0?block.slice(endH2,endH2+400):block)||xDate(block),best.href,sourceId);
}

function buildItem(slug,title,date,href,sourceId){
  var url=href.indexOf('http')===0?href:'https://www.pch.dz'+href;
  var rm=title.match(/N[o°º]\s*([\w\-\/]+)/i);
  var di=title.lastIndexOf(' - ');
  var pr=di>5?title.slice(di+3).replace(/[^ -~]/g,'').trim():null;
  return{id:slug,title:title,date:date,reference:rm?'N°'+rm[1].trim():null,produit:pr&&pr.length>2?pr:null,url:url,sourceId:sourceId};
}

var ENM={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
var FRM={janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12,fev:2,avr:4,juil:7};
function xDate(c){if(!c)return null;var m1=c.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[,.]?\s*(\d{4})\b/i);if(m1){var n1=ENM[m1[2].toLowerCase().slice(0,3)];if(n1)return m1[3]+'-'+p2(n1)+'-'+p2(+m1[1]);}var c2=c.toLowerCase().replace(/[éèê]/g,'e').replace(/[ûù]/g,'u').replace(/[àâ]/g,'a').replace(/î/g,'i').replace(/ô/g,'o');var m2=c2.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|fev|avr|juil)\s+(\d{4})\b/);if(m2){var n2=FRM[m2[2]];if(n2)return m2[3]+'-'+p2(n2)+'-'+p2(+m2[1]);}var m3=c.match(/\b(202\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);if(m3)return m3[0];var m4=c.match(/\b([0-3]?\d)\/(0[1-9]|1[0-2])\/(202\d)\b/);if(m4)return m4[3]+'-'+m4[2]+'-'+p2(+m4[1]);return null;}
function isTender(t){return/AVIS|APPEL|CONSULTATION|ATTRIBUTION|INFRUCTUOS|ADDITIF|PROROGATION|ANNUL|AONO/i.test(t);}
function strip(h){return(h||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function sOf(href){var p=(href||'').split('/').filter(Boolean);return p.length?p[p.length-1]:href;}
function p2(n){return n<10?'0'+n:''+n;}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('PCH Watch Scraper — ' + new Date().toISOString());
  var result = { scrapedAt: new Date().toISOString(), sources: {}, allItems: [] };

  // Load existing data to merge (preserve history)
  var existing = { sources: {}, allItems: [] };
  try {
    var raw = fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8');
    existing = JSON.parse(raw);
    console.log('Loaded existing data:', existing.allItems.length, 'items');
  } catch(e) {
    console.log('No existing data.json, starting fresh');
  }

  for (var si = 0; si < SOURCES.length; si++) {
    var src = SOURCES[si];
    console.log('\n── Scraping:', src.label);
    var seen = {};
    var srcItems = [];

    for (var page = 0; page < MAX_PAGES; page++) {
      var url = page === 0 ? src.url : src.url + '?page=' + page;
      try {
        console.log('  Page', page, ':', url);
        var html = await get(url, 30000);

        if (html.indexOf('Request Rejected') >= 0) {
          console.log('  ❌ WAF block on page', page);
          break;
        }

        var items = parseItems(html, src.id, seen);
        console.log('  ✅', items.length, 'items found');

        if (items.length === 0) break;
        for (var k = 0; k < items.length; k++) srcItems.push(items[k]);
        if (items.length < 4) break;

        await sleep(500);
      } catch(e) {
        console.log('  ⚠️  Error page', page, ':', e.message);
        break;
      }
    }

    result.sources[src.id] = srcItems;
    console.log('Total for', src.id, ':', srcItems.length, 'items');
  }

  // Merge: combine fresh items with existing, deduplicate, sort by date
  var allNew = [];
  Object.keys(result.sources).forEach(function(sid) {
    result.sources[sid].forEach(function(item) { allNew.push(item); });
  });

  // Merge with existing (keep history, add new)
  var seenKeys = {};
  var merged = [];
  allNew.forEach(function(i) {
    var key = i.sourceId + '|' + i.id;
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(i); }
  });
  (existing.allItems || []).forEach(function(i) {
    var key = i.sourceId + '|' + i.id;
    if (!seenKeys[key]) { seenKeys[key] = true; merged.push(i); }
  });

  merged.sort(function(a, b) {
    var da = a.date ? new Date(a.date) : null;
    var db = b.date ? new Date(b.date) : null;
    if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
    return db - da;
  });

  result.allItems = merged.slice(0, 1000); // Keep max 1000 items
  result.totalCount = merged.length;
  result.freshCount = allNew.length;

  // Write data.json
  var outputPath = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log('\n✅ data.json written —', result.allItems.length, 'items total,', allNew.length, 'fresh');
}

main().catch(function(e) {
  console.error('Fatal error:', e);
  process.exit(1);
});
