#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program.name('pensieve').description('Mines Claude Code session transcripts for daily insight briefs.');

program
  .command('analyze')
  .description('Run the ingestion/extraction pipeline and update today\'s brief.')
  .action(() => {
    console.log('not yet implemented');
    process.exit(0);
  });

program.parse();
