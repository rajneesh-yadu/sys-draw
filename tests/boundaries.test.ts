// @vitest-environment node
/**
 * Guards the module-boundary lint config itself: if eslint.config.js stops
 * enforcing the dependency table or the index.ts entry-point rule, this fails.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const probe = `${root}src/core/__boundary_probe__.ts`;
const eslint = new ESLint({ cwd: root });

async function boundaryErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId?.startsWith('boundaries/'))
    .map((m) => m.ruleId);
}

beforeAll(() => writeFileSync(probe, 'export const probe = 1;\n'));
afterAll(() => rmSync(probe, { force: true }));

describe('module boundaries', () => {
  it('allows a listed dependency through index.ts', async () => {
    expect(await boundaryErrors('src/registry/x.ts', "export * from '@/core';\n")).toEqual([]);
    expect(await boundaryErrors('src/modes/x.ts', "export * from '../engine';\n")).toEqual([]);
  });

  it('blocks a dependency missing from the table', async () => {
    expect(await boundaryErrors('src/engine/x.ts', "export * from '@/canvas';\n")).toContain(
      'boundaries/dependencies',
    );
    expect(await boundaryErrors('src/core/x.ts', "export * from '../registry';\n")).toContain(
      'boundaries/dependencies',
    );
    expect(await boundaryErrors('src/metrics-ui/x.ts', "export * from '@/engine';\n")).toContain(
      'boundaries/dependencies',
    );
  });

  it('blocks reaching into another module past its index.ts', async () => {
    expect(
      await boundaryErrors('src/registry/x.ts', "export * from '@/core/__boundary_probe__';\n"),
    ).toContain('boundaries/dependencies');
  });

  it('allows imports inside the same module', async () => {
    expect(
      await boundaryErrors('src/core/x.ts', "export * from './__boundary_probe__';\n"),
    ).toEqual([]);
  });

  it('keeps React out of the engine', async () => {
    const [result] = await eslint.lintText("import 'react';\n", {
      filePath: `${root}src/engine/x.ts`,
    });
    expect(result?.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });
});
