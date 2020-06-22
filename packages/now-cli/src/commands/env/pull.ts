import chalk from 'chalk';
import { ProjectEnvTarget, Project } from '../../types';
import { Output } from '../../util/output';
import promptBool from '../../util/prompt-bool';
import Client from '../../util/client';
import stamp from '../../util/output/stamp';
import param from '../../util/output/param';
import withSpinner from '../../util/with-spinner';
import { join } from 'path';
import { promises, existsSync } from 'fs';
import { emoji, prependEmoji } from '../../util/emoji';
import { getCommandName } from '../../util/pkg-name';
import getDecryptedEnvRecords from '../../util/get-decrypted-env-records';

import { Env } from '@vercel/build-utils';

const { writeFile } = promises;

type Options = {
  '--debug': boolean;
  '--yes': boolean;
};

export default async function pull(
  client: Client,
  project: Project,
  opts: Options,
  args: string[],
  output: Output
) {
  if (args.length > 1) {
    output.error(
      `Invalid number of arguments. Usage: ${getCommandName(`env pull <file>`)}`
    );
    return 1;
  }

  const [filename = '.env'] = args;
  const fullPath = join(process.cwd(), filename);
  const exists = existsSync(fullPath);
  const skipConfirmation = opts['--yes'];

  if (
    exists &&
    !skipConfirmation &&
    !(await promptBool(
      output,
      `Found existing file ${param(filename)}. Do you want to overwrite?`
    ))
  ) {
    output.log('Aborted');
    return 0;
  }

  output.print(
    `Downloading Development Environment Variables for Project ${chalk.bold(
      project.name
    )}\n`
  );
  const pullStamp = stamp();

  const records: Env = await withSpinner(
    'Downloading',
    async () =>
      await getDecryptedEnvRecords(
        output,
        client,
        project,
        ProjectEnvTarget.Development
      )
  );

  if (!records) {
    output.print(
      `No Development Environment Variables found for Project ${chalk.bold(
        project.name
      )}\n`
    );
    return;
  }

  const contents =
    Object.entries(records)
      .map(([key, value]) => `${key}="${escapeValue(value)}"`)
      .join('\n') + '\n';

  await writeFile(fullPath, contents, 'utf8');

  output.print(
    `${prependEmoji(
      `${exists ? 'Updated' : 'Created'} ${chalk.bold(
        filename
      )} file ${chalk.gray(pullStamp())}`,
      emoji('success')
    )}\n`
  );
  return 0;
}

function escapeValue(value: string) {
  return value
    .replace(new RegExp('\n', 'g'), '\\n') // combine newlines (unix) into one line
    .replace(new RegExp('\r', 'g'), '\\r'); // combine newlines (windows) into one line
}
