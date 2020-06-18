import { join, dirname, relative, parse as parsePath, sep } from 'path';
import buildUtils from './build-utils';
import {
  BuildOptions,
  Lambda as LambdaType,
  createLambda,
  Files,
} from '@vercel/build-utils';
const {
  download,
  glob,
  shouldServe,
  debug,
  getNodeVersion,
  getSpawnOptions,
  runNpmInstall,
  spawnAsync,
  FileBlob,
  FileFsRef,
} = buildUtils;
import { makeAwsLauncher } from './launcher';
const {
  getDependencies,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('@netlify/zip-it-and-ship-it/src/dependencies.js');

const LAUNCHER_FILENAME = '___now_launcher';
const BRIDGE_FILENAME = '___now_bridge';
const HELPERS_FILENAME = '___now_helpers';
const SOURCEMAP_SUPPORT_FILENAME = '__sourcemap_support';

export const version = 2;

export async function build({
  workPath,
  files,
  entrypoint,
  meta = {},
  config = {},
}: BuildOptions) {
  await download(files, workPath, meta);

  const entrypointFsDirname = join(workPath, dirname(entrypoint));
  const nodeVersion = await getNodeVersion(
    entrypointFsDirname,
    undefined,
    config,
    meta
  );

  const spawnOpts = getSpawnOptions(meta, nodeVersion);
  await runNpmInstall(
    entrypointFsDirname,
    ['--prefer-offline'],
    spawnOpts,
    meta
  );

  debug('Running build script...');
  await spawnAsync('yarn', ['rw', 'build'], {
    ...spawnOpts,
    cwd: workPath,
    prettyCommand: 'yarn rw build',
  });

  const apiDistPath = join(workPath, 'api', 'dist', 'functions');
  const webDistPath = join(workPath, 'web', 'dist');
  const lambdaOutputs: { [filePath: string]: LambdaType } = {};
  const staticOutputs = await glob('**', webDistPath);

  // Each file in the `functions` dir will become a lambda
  const functionFiles = await glob('*.js', apiDistPath);

  console.log({ functionFiles });

  for (const [funcName, fileFsRef] of Object.entries(functionFiles)) {
    const outputName = join('api', parsePath(funcName).name); // remove `.js` extension
    const absEntrypoint = fileFsRef.fsPath;
    const dependencies: string[] = await getDependencies(
      absEntrypoint,
      workPath
    );
    const relativeEntrypoint = relative(workPath, absEntrypoint);
    const awsLambdaHandler = getAWSLambdaHandler(relativeEntrypoint, 'handler');

    console.log({
      outputName,
      absEntrypoint,
      relativeEntrypoint,
      awsLambdaHandler,
    });

    const lambdaFiles: Files = {
      [`${LAUNCHER_FILENAME}.js`]: new FileBlob({
        data: makeAwsLauncher({
          entrypointPath: `./${relativeEntrypoint}`,
          bridgePath: `./${BRIDGE_FILENAME}`,
          helpersPath: `./${HELPERS_FILENAME}`,
          sourcemapSupportPath: `./${SOURCEMAP_SUPPORT_FILENAME}`,
          shouldAddHelpers: false,
          shouldAddSourcemapSupport: false,
          awsLambdaHandler,
        }),
      }),
      [`${BRIDGE_FILENAME}.js`]: new FileFsRef({
        fsPath: join(__dirname, 'bridge.js'),
      }),
    };

    dependencies.forEach(fsPath => {
      lambdaFiles[relative(workPath, fsPath)] = new FileFsRef({ fsPath });
    });

    console.log(
      'adding entrypoint file ' + relative(workPath, fileFsRef.fsPath)
    );
    lambdaFiles[relative(workPath, fileFsRef.fsPath)] = fileFsRef;

    const lambda = await createLambda({
      files: lambdaFiles,
      handler: `${LAUNCHER_FILENAME}.launcher`,
      runtime: nodeVersion.runtime,
      environment: {},
    });
    lambdaOutputs[outputName] = lambda;
  }

  return {
    output: { ...staticOutputs, ...lambdaOutputs },
    routes: [{ handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }],
    watch: [],
  };
}

function getAWSLambdaHandler(filePath: string, handlerName: string) {
  const { dir, name } = parsePath(filePath);
  return `${dir}${dir ? sep : ''}${name}.${handlerName}`;
}

export { shouldServe };
