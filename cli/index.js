import { Command } from 'commander'
import init from './commands/init.js'
import push from './commands/push.js'
import gateCheck from './commands/gateCheck.js'

const program = new Command()

program
  .name('dockium')
  .description('Dockium git gate CLI')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize dockium in this project')
  .action(async () => {
    await init()
  })

program
  .command('push')
  .description('Scan -> test -> push to GitHub')
  .option('--remote <r>', 'remote name', 'origin')
  .option('--branch <b>', 'branch to push')
  .option('--skip-gate', 'skip the gate check')
  .option('--enforce-gate', 'block push when gate fails')
  .option('--allow-report-artifacts', 'allow pushing dockium report artifacts (docx/pdf/md/json)')
  .option('--auto-commit', 'auto-commit local changes before gate and push')
  .option('--commit-message <msg>', 'commit message used with --auto-commit')
  .action(async (options) => {
    await push(options)
  })

program
  .command('gate-check')
  .description('Run gate check (used by git hook)')
  .option('--warn-only', 'do not block on gate policy findings')
  .option('--enforce-gate', 'strict mode: block when gate policy fails')
  .argument('[gitArgs...]', 'ignored git hook arguments')
  .action(async (options) => {
    await gateCheck(options)
  })

program.parseAsync(process.argv).catch((error) => {
  console.error('[DOCKIUM] CLI error:', String(error?.message || error))
  process.exit(1)
})
