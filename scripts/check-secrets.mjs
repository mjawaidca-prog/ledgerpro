import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowedFiles = new Set(['.env.example']);
const binaryExtensions = /\.(?:ico|png|jpe?g|gif|webp|woff2?|pdf|zip)$/i;
const patterns = [
  { name: 'PostgreSQL URL with embedded credentials', regex: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/g },
  { name: 'Stripe live secret key', regex: /sk_live_[A-Za-z0-9]{16,}/g },
  { name: 'Stripe webhook secret', regex: /whsec_[A-Za-z0-9]{16,}/g },
  { name: 'Resend API key', regex: /\bre_[A-Za-z0-9]{16,}/g },
  { name: 'GitHub token', regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g },
  { name: 'OpenAI API key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'Committed NextAuth secret', regex: /^NEXTAUTH_SECRET=(?!["']?(?:replace|change|example|test))[^\r\n]{16,}$/gim },
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !allowedFiles.has(file) && !binaryExtensions.test(file));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const { name, regex } of patterns) {
    regex.lastIndex = 0;
    if (regex.test(content)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length) {
  console.error('Potential committed secrets detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  console.error('Rotate exposed credentials and store them only in the deployment provider.');
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} tracked text files checked).`);
