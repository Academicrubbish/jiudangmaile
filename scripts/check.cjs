const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'config.local.json') files.push(p);
  }
}
for (const dir of [
  'services',
  'components/jdml',
  'pages/home',
  'pages/welcome',
  'pages/setup',
  'pages/receipt',
  'pages/history',
  'pages/invite',
  'pages/profile',
  'uniCloud-aliyun/cloudfunctions/jdml-api',
  'uniCloud-aliyun/cloudfunctions/jdml-worker',
  'uniCloud-aliyun/cloudfunctions/common/jdml-core',
  'tests'
])
  walk(path.join(root, dir));
let count = 0;
for (const folder of ['jdml-api', 'jdml-worker', 'common/jdml-core']) {
  const cloudPackagePath = path.join(
    root,
    'uniCloud-aliyun/cloudfunctions',
    folder,
    'package.json'
  );
  for (const [name, dependency] of Object.entries(
    JSON.parse(fs.readFileSync(cloudPackagePath)).dependencies || {}
  )) {
    if (
      dependency.startsWith('file:') &&
      !fs.existsSync(
        path.resolve(
          path.dirname(cloudPackagePath),
          dependency.slice(5),
          'package.json'
        )
      )
    )
      throw new Error('Missing cloud dependency: ' + name);
  }
}

for (const file of files) {
  if (/\.(js|cjs)$/.test(file)) {
    const esm = file.includes('/services/');
    const r = cp.spawnSync(
      process.execPath,
      esm ? ['--input-type=module', '--check'] : ['--check', file],
      { input: esm ? fs.readFileSync(file) : undefined, encoding: 'utf8' }
    );
    if (r.status) {
      process.stderr.write(r.stderr);
      process.exit(1);
    }
    count++;
  } else if (file.endsWith('.json')) {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    count++;
  }
}
const pages = JSON.parse(fs.readFileSync(path.join(root, 'pages.json')));
for (const p of pages.pages) {
  if (!fs.existsSync(path.join(root, p.path + '.vue')))
    throw new Error('Missing page ' + p.path);
}
for (const name of fs
  .readdirSync(path.join(root, 'uniCloud-aliyun/database'))
  .filter((n) => n.startsWith('jdml-') && n.endsWith('.json')))
  JSON.parse(
    fs.readFileSync(path.join(root, 'uniCloud-aliyun/database', name))
  );
console.log(
  `${count} JS/JSON files checked; ${pages.pages.length} page routes resolved. Vue templates require the uni-app compiler check.`
);
