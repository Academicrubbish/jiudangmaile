const path = require('path'),
  { spawnSync } = require('child_process');
const target = process.argv[2];
if (!['h5', 'mp-weixin'].includes(target))
  throw new Error('Use h5 or mp-weixin');
const root = path.resolve(__dirname, '..');
const compiler = path.join(
  path.dirname(require.resolve('@dcloudio/vite-plugin-uni/package.json')),
  'bin/uni.js'
);
const result = spawnSync(process.execPath, [compiler, 'build', '-p', target], {
  stdio: 'inherit',
  cwd: root,
  env: {
    ...process.env,
    UNI_INPUT_DIR: root,
    UNI_OUTPUT_DIR: path.join(root, 'unpackage/dist/build', target)
  }
});
process.exit(result.status || 0);
