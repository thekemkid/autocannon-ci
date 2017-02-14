#! /usr/bin/env node

'use strict'

const path = require('path')
const debug = require('debug')('autocannon-ci:cli')
const minimist = require('minimist')
const fs = require('fs')
const Runner = require('./lib/runner')
const YAML = require('yamljs')
const chalk = require('chalk')
const autocannon = require('autocannon')
const psTree = require('ps-tree')
const help = require('help-me')({
  dir: 'help',
  help: 'autocannon-ci.txt'
})
const storage = require('./lib/storage')
const fsBlobStorage = require('fs-blob-store')

// get the current node path for clean windows support
const isWin = /^win/.test(process.platform)
const nodePath = isWin ? ('"' + process.argv[0] + '"') : process.argv[0]
const zeroX = path.join(path.dirname(require.resolve('0x')), 'cmd.js')

function hasFile (file) {
  try {
    fs.accessSync(file)
    return true
  } catch (err) {
    return false
  }
}

function start () {
  const args = minimist(process.argv, {
    boolean: ['flamegraph'],
    integer: ['job'],
    alias: {
      config: 'c',
      job: 'j',
      flamegraph: 'F'
    },
    default: {
      config: path.resolve('autocannon.yml'),
      job: 1,
      flamegraph: false
    }
  })

  if (!hasFile(args.config)) {
    help.toStdout()
    return
  }

  // should never throw, we have just
  // checked if we can access this
  const data = fs.readFileSync(args.config, 'utf8')

  try {
    var config = YAML.parse(data)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  var exec = nodePath

  if (args.flamegraph) {
    if (isWin) {
      console.error('flamegraphs are supported only on Linux and Mac OS X')
      process.exit(1)
    }

    exec = zeroX
    config.server = '--svg ' + config.server
  }

  const wd = path.dirname(path.resolve(args.config))
  const runner = new Runner(config, args.job, wd, exec)

  if (config.storage && config.storage.type === 'fs') {
    const backing = fsBlobStorage(path.resolve(path.join(wd, config.storage.path || 'perf-results')))
    storage(backing).wire(runner)
  }

  runner.on('server', function (data) {
    console.log(chalk.green(`==> Started server`))
    console.log(chalk.green(`    url: ${data.url}`))
    console.log(chalk.green(`    pid: ${data.pid}`))
    console.log(chalk.green(`    cmd: ${data.cmd}`))
    console.log(chalk.green(`    exe: ${data.exe}`))
    console.log()
  })

  runner.on('warmup', function (url) {
    console.log(chalk.red(`==> warming up ${url} for 3s`))
    console.log()
  })

  runner.on('bench', function (data, cannon) {
    process.stdout.write('==> ')
    autocannon.track(cannon)
    cannon.on('done', function () {
      console.log()
    })
  })

  runner.on('error', function (err) {
    console.error(err.message)
    process.exit(1)
  })
}

if (require.main === module) {
  start()

  process.on('uncaughtException', cleanup)
  process.on('beforeExit', cleanup)
}

function cleanup (err) {
  if (err) {
    console.error(err)
  }

  process.removeListener('uncaughtException', cleanup)
  process.removeListener('beforeExit', cleanup)

  // cleanup all the children processes
  psTree(process.pid, function (err2, children) {
    if (err2) {
      throw err2
    }

    children
      .map((p) => p.PID)
      .filter((p) => p !== process.pid)
      .forEach((p) => {
        try {
          process.kill(p, 'SIGKILL')
        } catch (err) {
          debug(err)
        }
      })

    if (err) {
      process.emit('uncaughtException', err)
    }
  })
}
