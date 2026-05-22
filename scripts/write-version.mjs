#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const versionPath = resolve(dist, 'version.json');

function git(command) {
  try {
    return execSync(command, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else if (path !== versionPath) out.push(path);
  }
  return out;
}

const hash = createHash('sha256');
for (const file of walk(dist)) {
  hash.update(relative(dist, file));
  hash.update('\0');
  hash.update(readFileSync(file));
  hash.update('\0');
}

let packageVersion = 'unknown';
try {
  packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version || packageVersion;
} catch {}

const siteHash = hash.digest('hex');
const siteGitHead = git('git rev-parse --short=12 HEAD');
const siteGitBranch = git('git branch --show-current');
const siteDirty = !!git('git status --porcelain -- .');
const buildId = [
  siteGitHead || 'nogit',
  siteHash.slice(0, 12),
  siteDirty ? 'dirty' : 'clean',
].join('-');

const version = {
  schemaVersion: 1,
  name: 'aiit-site',
  packageVersion,
  buildId,
  siteGitHead,
  siteGitBranch,
  siteDirty,
  siteHash,
  issueApiVersion: '2026-04-25.1',
  androidPackage: 'com.aiitcorp.threshold',
};

writeFileSync(versionPath, JSON.stringify(version, null, 2) + '\n');
console.log(`[write-version] wrote ${relative(root, versionPath)} ${buildId}`);
