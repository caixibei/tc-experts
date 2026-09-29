import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only metadata walk. Does not open media bodies or follow symlinks.
export async function inventory(root, { terms = [], maxEntries = 100000, maxMatches = 2000, maxMilliseconds = 30000 } = {}) {
  if (!root || !Array.isArray(terms) || terms.some(t => typeof t !== 'string' || t.length > 200) || terms.length > 32 || ![maxEntries,maxMatches,maxMilliseconds].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('invalid_inventory_options');
  const absoluteRoot = path.resolve(root);
  if (!(await fs.lstat(absoluteRoot)).isDirectory() || (await fs.lstat(absoluteRoot)).isSymbolicLink()) throw new Error('root_must_be_real_directory');
  const started = Date.now(), stack = [absoluteRoot], matches = [], errors = [];
  let visitedEntries = 0, files = 0, bytes = 0, directories = 0, symlinksSkipped = 0, matchedFiles = 0, matchedBytes = 0, stopReason = null;
  outer: while (stack.length) {
    const dir = stack.pop();
    let handle;
    try { handle = await fs.opendir(dir); } catch (e) { if(errors.length < 100) errors.push({path:path.relative(absoluteRoot,dir),code:e.code}); continue; }
    for await (const entry of handle) {
      if (visitedEntries >= maxEntries || Date.now()-started >= maxMilliseconds) { stopReason = visitedEntries >= maxEntries ? 'entry_budget' : 'time_budget'; break outer; }
      visitedEntries++;
      const full = path.join(dir,entry.name), relative = path.relative(absoluteRoot,full).split(path.sep).join('/');
      let stat;
      try { stat = await fs.lstat(full); } catch(e) { if(errors.length < 100) errors.push({path:relative,code:e.code}); continue; }
      if (stat.isSymbolicLink()) { symlinksSkipped++; continue; }
      if (stat.isDirectory()) { directories++; stack.push(full); continue; }
      if (!stat.isFile()) continue;
      files++; bytes += stat.size;
      if (!Number.isSafeInteger(bytes)) { stopReason='byte_sum_overflow'; break outer; }
      if (!terms.length || terms.some(t => relative.toLowerCase().includes(t.toLowerCase()))) {
        matchedFiles++; matchedBytes += stat.size;
        if (matches.length < maxMatches) matches.push({id:relative,path:full,kind:'file',bytes:stat.size,modifiedAt:stat.mtime.toISOString(),basis:'path_keyword_only',contentRead:false});
      }
    }
  }
  return {schemaVersion:'manuscriptos.material-inventory/v1',root:absoluteRoot,observedAt:new Date().toISOString(),scope:'metadata_only_nonatomic_snapshot',complete:!stopReason && !errors.length && symlinksSkipped===0,stopReason,visitedEntries,files,bytes,directories,symlinksSkipped,matchedFiles,matchedBytes,returnedMatches:matches.length,omittedMatches:matchedFiles-matches.length,matches,errors,contentRead:false,networkUsed:false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root,...terms] = process.argv.slice(2);
    if (root === '--help' && !terms.length) {
      process.stdout.write(JSON.stringify({ok:true,usage:'node material-inventory.mjs <root> [terms...]',alternative:'node expert-tools.mjs inventory < input.json',contentRead:false,networkUsed:false})+'\n');
    } else {
      const result=await inventory(root,{terms});
      process.stdout.write(JSON.stringify(result)+'\n');
      if (!result.complete) process.exitCode=2;
    }
  } catch(error) { process.stderr.write(error.message+'\n'); process.exitCode=1; }
}
