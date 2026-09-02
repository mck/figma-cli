// Commands: apply, read, context, sweep (agent-speed document protocol)
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'fs';
import { stringify as stringifyYaml } from 'yaml';
import {
  program,
  checkConnection,
  daemonExec,
  figmaEvalSync,
} from '../lib/cli-core.js';
import { compileDoc, compileDocFile } from '../lib/doc/compile.js';
import { loadDocFile } from '../lib/doc/model.js';
import {
  buildSweepDoc,
  parsePromote,
  parseSweepSource,
  promoteKnobs,
  variantCount,
} from '../lib/doc/sweep.js';
import { buildContextScript, buildDecompileScript } from '../lib/doc/runtime.js';

function printResult(result) {
  const out = result && typeof result === 'object' ? result : { ok: false, error: String(result) };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

function dumpDoc(doc, output, asJson) {
  const text = asJson ? JSON.stringify(doc, null, 2) + '\n' : stringifyYaml(doc);
  if (output) {
    writeFileSync(output, text);
    console.log(chalk.green('Wrote ' + output));
  } else {
    process.stdout.write(text);
  }
}

program
  .command('apply <doc>')
  .description('Compile a Figma Doc in one plugin execution and return a name-to-id map')
  .option('-c, --collection <name>', 'Pin unscoped var:name lookups to this collection')
  .option('--create', 'Always create nodes (skip key upsert)')
  .action(async (docPath, options) => {
    checkConnection();
    const { script, ir } = await compileDocFile(docPath, {
      collection: options.collection,
      diff: !options.create,
    });
    const result = await daemonExec('eval', { code: script }, 120000);
    if (result && typeof result === 'object') {
      result.compiledNodes = ir.nodes.length;
    }
    printResult(result);
  });

program
  .command('read [target]')
  .description('Decompile selection, a node id, or the current page to a Figma Doc')
  .option('-o, --output <file>', 'Write YAML (or JSON with --json) to this path')
  .option('--json', 'Emit JSON instead of YAML')
  .action((target, options) => {
    checkConnection();
    let scope = 'selection';
    let nodeId = null;
    if (!target || target === 'selection') scope = 'selection';
    else if (target === 'page') scope = 'page';
    else {
      scope = 'node';
      nodeId = target;
    }
    const result = figmaEvalSync(buildDecompileScript(nodeId, scope === 'node' ? 'node' : scope));
    if (!result || result.error) {
      console.error(chalk.red(result && result.error ? result.error : 'read failed'));
      process.exit(1);
    }
    dumpDoc(result, options.output, options.json);
  });

program
  .command('context')
  .description('One JSON payload: collections, modes, variables, binding syntax, page/selection')
  .action(() => {
    checkConnection();
    const result = figmaEvalSync(buildContextScript());
    if (!result || result.error) {
      console.error(chalk.red(result && result.error ? result.error : 'context failed'));
      process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('sweep <doc> <sweepFile>')
  .description('Compile a labeled knob matrix in one apply; --promote writes a cell back into the doc')
  .option('--promote <spec>', 'Lift a variant (pad=16,intent=cozy) into the base doc knobs')
  .option('-o, --output <file>', 'When --promote is set, write the promoted doc here instead of overwriting <doc>')
  .option('-c, --collection <name>', 'Pin unscoped var:name lookups to this collection')
  .action(async (docPath, sweepPath, options) => {
    const rawDoc = loadDocFile(docPath);
    const sweep = parseSweepSource(readFileSync(sweepPath, 'utf8'), sweepPath);

    if (options.promote) {
      const set = parsePromote(options.promote);
      const promoted = promoteKnobs(rawDoc, set);
      const dest = options.output || docPath;
      writeFileSync(dest, stringifyYaml(promoted));
      console.log(JSON.stringify({ promoted: dest, knobs: promoted.knobs }, null, 2));
    }

    checkConnection();
    const sweepDoc = buildSweepDoc(rawDoc, sweep);
    const { script, ir } = await compileDoc(sweepDoc, {
      filename: sweepPath,
      collection: options.collection,
      diff: true,
    });
    const result = await daemonExec('eval', { code: script }, 120000);
    if (result && typeof result === 'object') {
      result.variants = variantCount(sweep);
      result.compiledNodes = ir.nodes.length;
    }
    printResult(result);
  });
