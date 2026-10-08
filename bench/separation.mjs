/**
 * Separation analysis over the saved formulation benchmark.
 *
 * Reads `bench/results/formulation-bench.json` and reports, per formulation and
 * confidence bar, how a gate would behave if it PASSED every command whose
 * "nothing to see here" verdict cleared that bar and sent the rest to a human.
 * No model time: this is pure bookkeeping over already-collected verdicts.
 */
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'results', 'formulation-bench.json'), 'utf8'))

const bars = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]

process.stdout.write('Separation: if the gate auto-passed every verdict clearing `bar`,\n')
process.stdout.write('how much of the traffic needs no human, and is that band trustworthy?\n')

const summary = {}
for (const [name, entry] of Object.entries(data.formulations)) {
  const rows = entry.cases
  const benign = rows.filter((r) => !r.label)
  const dangerous = rows.filter((r) => r.label)
  process.stdout.write(`\n=== ${name}   (recall on dangerous ${entry.recall.toFixed(4)})\n`)
  process.stdout.write('   bar  auto-pass  benign coverage  dangerous passed  purity\n')
  summary[name] = {}
  for (const bar of bars) {
    const auto = rows.filter((r) => r.pass && (r.confidence ?? 0) >= bar)
    const benignAuto = auto.filter((r) => !r.label).length
    const dangerousPassed = auto.filter((r) => r.label).length
    const coverage = benignAuto / benign.length
    const purity = auto.length === 0 ? null : benignAuto / auto.length
    summary[name][bar] = { autoPass: auto.length, benignCoverage: coverage, dangerousPassed, purity }
    process.stdout.write(
      `  ${bar.toFixed(2)}  ${String(auto.length).padStart(9)}  ` +
      `${(coverage * 100).toFixed(0).padStart(14)}%  ${String(dangerousPassed).padStart(16)}  ` +
      `${purity === null ? '   n/a' : purity.toFixed(4)}\n`)
  }
  const passedDangerous = rows.filter((r) => r.label && r.pass)
  if (passedDangerous.length > 0) {
    process.stdout.write(`   dangerous the model wanted to PASS at all (${passedDangerous.length}):\n`)
    for (const row of passedDangerous) {
      process.stdout.write(`     conf=${(row.confidence ?? 0).toFixed(4)}  ${row.command.slice(0, 66)}\n`)
    }
  }
}

fs.writeFileSync(path.join(HERE, 'results', 'separation.json'),
  `${JSON.stringify(summary, null, 1)}\n`, 'utf8')
process.stdout.write('\nwrote bench/results/separation.json\n')
