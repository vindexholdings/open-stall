import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every password-entry field in the app must come from the shared TextField, which owns the Show/Hide control. A raw
// <TextInput secureTextEntry> anywhere else would be a password field without the control.
const root = join(__dirname, '..');
const files: string[] = [];
const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(f)) files.push(p); } };
walk(root);

describe('password fields', () => {
  it('only the shared TextField renders a raw secure input', () => {
    const offenders = files.filter((f) => /<TextInput[^>]*secureTextEntry/s.test(readFileSync(f, 'utf8')) && !f.endsWith('TextField.tsx'));
    expect(offenders).toEqual([]);
  });
  it('the known password screens use TextField with secureTextEntry (sign-in/sign-up and reset)', () => {
    const using = files.filter((f) => /<TextField[^>]*secureTextEntry/s.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1)).sort();
    expect(using).toEqual(['app/auth/reset.tsx', 'app/auth/sign-in.tsx']);
  });
  it('the shared field never gives the toggle a value-bearing label and keeps the input mounted', () => {
    const src = readFileSync(join(root, 'components/TextField.tsx'), 'utf8');
    expect(src).toMatch(/Show password/);
    expect(src).toMatch(/Hide password/);
    expect(src).not.toMatch(/accessibilityLabel=\{[^}]*value/);
    expect(src).not.toMatch(/key=\{[^}]*revealed/);
  });
});
