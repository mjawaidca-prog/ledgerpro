/**
 * Merge per-entity GL lines into one consolidated line set.
 *
 * Primary key is the account code (the seeded chart of accounts shares codes
 * across companies). When an account exists in only one entity but another
 * entity carries a *different* code with the same GIFI code, the amounts are
 * re-routed onto the shared line and a warning is emitted naming both
 * accounts (divergent charts case).
 */

import type { ConsolidatedLine, EntityLine } from './types';

export interface MergeWarning {
  code: string;
  message: string;
}

interface MergeLine extends ConsolidatedLine {
  // internal bookkeeping only
}

export function mergeEntityLines(
  entities: { companyId: string; lines: EntityLine[] }[]
): { lines: ConsolidatedLine[]; warnings: MergeWarning[] } {
  const warnings: MergeWarning[] = [];
  const byCode = new Map<string, MergeLine>();

  // Pass 1 — merge on code.
  for (const entity of entities) {
    for (const line of entity.lines) {
      let merged = byCode.get(line.code);
      if (!merged) {
        merged = {
          code: line.code,
          name: line.name,
          gifiCode: line.gifiCode,
          type: line.type,
          subType: line.subType,
          detailType: line.detailType,
          byEntity: {},
          elimination: 0,
          consolidated: 0,
        };
        byCode.set(line.code, merged);
      } else if (merged.type !== line.type) {
        warnings.push({
          code: 'chart_merge',
          message: `Account ${line.code} (${line.name}) has conflicting types across entities — using ${merged.type}.`,
        });
      }
      if (!merged.gifiCode && line.gifiCode) merged.gifiCode = line.gifiCode;
      merged.byEntity[entity.companyId] = (merged.byEntity[entity.companyId] ?? 0) + line.amount;
    }
  }

  // Which entity ids carry each code?
  const codeOwners = new Map<string, Set<string>>();
  for (const entity of entities) {
    for (const line of entity.lines) {
      if (!codeOwners.has(line.code)) codeOwners.set(line.code, new Set());
      codeOwners.get(line.code)!.add(entity.companyId);
    }
  }

  // First code seen per GIFI (for re-routing divergent codes).
  const gifiFirst = new Map<string, { code: string; name: string }>();
  for (const entity of entities) {
    for (const line of entity.lines) {
      if (line.gifiCode && !gifiFirst.has(line.gifiCode)) {
        gifiFirst.set(line.gifiCode, { code: line.code, name: line.name });
      }
    }
  }

  // Pass 2 — GIFI fallback for codes that exist in only one entity while
  // another entity uses a different code for the same GIFI.
  for (const entity of entities) {
    for (const line of entity.lines) {
      if (!line.gifiCode) continue;
      const owners = codeOwners.get(line.code);
      if (owners && owners.size > 1) continue; // properly shared code
      const first = gifiFirst.get(line.gifiCode);
      if (!first || first.code === line.code) continue;
      const target = byCode.get(first.code);
      if (!target) continue;

      const solo = byCode.get(line.code);
      if (solo && solo.byEntity[entity.companyId] !== undefined) {
        target.byEntity[entity.companyId] =
          (target.byEntity[entity.companyId] ?? 0) + solo.byEntity[entity.companyId];
        delete solo.byEntity[entity.companyId];
        if (Object.keys(solo.byEntity).length === 0) byCode.delete(line.code);
        warnings.push({
          code: 'chart_merge',
          message: `Merged "${line.name}" (${line.code}) into "${target.name}" (${target.code}) on GIFI ${line.gifiCode}.`,
        });
      }
    }
  }

  const lines = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { lines, warnings };
}
