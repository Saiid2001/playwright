import { spawn } from "child_process";
import * as Constants from "./constants.js";
import { Browser, BrowserContext, BrowserContextOptions, chromium, devices, firefox, LaunchOptions, webkit } from "playwright-core";

import os from 'os';
import { BrowsingClientParams, gracefullyProcessExitDoNotHang } from "./utils.js";
import path from "path";
export type LeaderParams = BrowsingClientParams & {};

type Options = {
  browser: string;
  channel?: string;
  colorScheme?: string;
  device?: string;
  geolocation?: string;
  ignoreHttpsErrors?: boolean;
  lang?: string;
  loadStorage?: string;
  proxyServer?: string;
  proxyBypass?: string;
  blockServiceWorkers?: boolean;
  saveHar?: string;
  saveHarGlob?: string;
  saveStorage?: string;
  saveTrace?: string;
  timeout?: string;
  timezone?: string;
  viewportSize?: string;
  userAgent?: string;
};

type CaptureOptions = {
  waitForSelector?: string;
  waitForTimeout?: string;
  fullPage: boolean;
};

function lookupBrowserType(name: string) {
  switch (name) {
    case 'chromium': return chromium;
    case 'firefox': return firefox;
    case 'webkit': return webkit;
    default: throw new Error(`Unknown browser: ${name}`);
  }
}

async function launchContext(options: Options, headless: boolean, executablePath?: string): Promise<{ browser: Browser, browserName: string, launchOptions: LaunchOptions, contextOptions: BrowserContextOptions, context: BrowserContext }> {
  const browserType = lookupBrowserType(options.browser);
  const launchOptions: LaunchOptions = { headless, executablePath };
  if (options.channel)
    launchOptions.channel = options.channel as any;
  launchOptions.handleSIGINT = false;

  const contextOptions: BrowserContextOptions =
    // Copy the device descriptor since we have to compare and modify the options.
    options.device ? { ...devices[options.device] } : {};

  // In headful mode, use host device scale factor for things to look nice.
  // In headless, keep things the way it works in Playwright by default.
  // Assume high-dpi on MacOS. TODO: this is not perfect.
  if (!headless)
    contextOptions.deviceScaleFactor = os.platform() === 'darwin' ? 2 : 1;

  // Work around the WebKit GTK scrolling issue.
  if (browserType.name() === 'webkit' && process.platform === 'linux') {
    delete contextOptions.hasTouch;
    delete contextOptions.isMobile;
  }

  if (contextOptions.isMobile && browserType.name() === 'firefox')
    contextOptions.isMobile = undefined;

  if (options.blockServiceWorkers)
    contextOptions.serviceWorkers = 'block';

  // Proxy

  if (options.proxyServer) {
    launchOptions.proxy = {
      server: options.proxyServer
    };
    if (options.proxyBypass)
      launchOptions.proxy.bypass = options.proxyBypass;
  }

  const browser = await browserType.launch(launchOptions);

  if (process.env.PWTEST_CLI_IS_UNDER_TEST) {
    (process as any)._didSetSourcesForTest = (text: string) => {
      process.stdout.write('\n-------------8<-------------\n');
      process.stdout.write(text);
      process.stdout.write('\n-------------8<-------------\n');
      const autoExitCondition = process.env.PWTEST_CLI_AUTO_EXIT_WHEN;
      if (autoExitCondition && text.includes(autoExitCondition))
        Promise.all(context.pages().map(async p => p.close()));
    };
    // Make sure we exit abnormally when browser crashes.
    const logs: string[] = [];
    require('playwright-core/lib/utilsBundle').debug.log = (...args: any[]) => {
      const line = require('util').format(...args) + '\n';
      logs.push(line);
      process.stderr.write(line);
    };
    browser.on('disconnected', () => {
      const hasCrashLine = logs.some(line => line.includes('process did exit:') && !line.includes('process did exit: exitCode=0, signal=null'));
      if (hasCrashLine) {
        process.stderr.write('Detected browser crash.\n');
        gracefullyProcessExitDoNotHang(1);
      }
    });
  }

  // Viewport size
  if (options.viewportSize) {
    try {
      const [width, height] = options.viewportSize.split(',').map(n => parseInt(n, 10));
      contextOptions.viewport = { width, height };
    } catch (e) {
      throw new Error('Invalid viewport size format: use "width, height", for example --viewport-size=800,600');
    }
  }

  // Geolocation

  if (options.geolocation) {
    try {
      const [latitude, longitude] = options.geolocation.split(',').map(n => parseFloat(n.trim()));
      contextOptions.geolocation = {
        latitude,
        longitude
      };
    } catch (e) {
      throw new Error('Invalid geolocation format, should be "lat,long". For example --geolocation="37.819722,-122.478611"');
    }
    contextOptions.permissions = ['geolocation'];
  }

  // User agent

  if (options.userAgent)
    contextOptions.userAgent = options.userAgent;

  // Lang

  if (options.lang)
    contextOptions.locale = options.lang;

  // Color scheme

  if (options.colorScheme)
    contextOptions.colorScheme = options.colorScheme as 'dark' | 'light';

  // Timezone

  if (options.timezone)
    contextOptions.timezoneId = options.timezone;

  // Storage

  if (options.loadStorage)
    contextOptions.storageState = options.loadStorage;

  if (options.ignoreHttpsErrors)
    contextOptions.ignoreHTTPSErrors = true;

  // HAR

  if (options.saveHar) {
    contextOptions.recordHar = { path: path.resolve(process.cwd(), options.saveHar), mode: 'minimal' };
    if (options.saveHarGlob)
      contextOptions.recordHar.urlFilter = options.saveHarGlob;
    contextOptions.serviceWorkers = 'block';
  }

  // Close app when the last window closes.

  const context = await browser.newContext(contextOptions);

  let closingBrowser = false;
  async function closeBrowser() {
    // We can come here multiple times. For example, saving storage creates
    // a temporary page and we call closeBrowser again when that page closes.
    if (closingBrowser)
      return;
    closingBrowser = true;
    if (options.saveTrace)
      await context.tracing.stop({ path: options.saveTrace });
    if (options.saveStorage)
      await context.storageState({ path: options.saveStorage }).catch(e => null);
    if (options.saveHar)
      await context.close();
    await browser.close();
  }

  context.on('page', page => {
    page.on('dialog', () => {});  // Prevent dialogs from being automatically dismissed.
    page.on('close', () => {
      const hasPage = browser.contexts().some(context => context.pages().length > 0);
      if (hasPage)
        return;
      // Avoid the error when the last page is closed because the browser has been closed.
      closeBrowser().catch(e => null);
    });
  });
  process.on('SIGINT', async () => {
    await closeBrowser();
    gracefullyProcessExitDoNotHang(130);
  });

  const timeout = options.timeout ? parseInt(options.timeout, 10) : 0;
  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);

  if (options.saveTrace)
    await context.tracing.start({ screenshots: true, snapshots: true });

  // Omit options that we add automatically for presentation purpose.
  delete launchOptions.headless;
  delete launchOptions.executablePath;
  delete launchOptions.handleSIGINT;
  delete contextOptions.deviceScaleFactor;
  return { browser, browserName: browserType.name(), context, contextOptions, launchOptions };
}

export class Leader {
  private _params: LeaderParams;
  private _browserWsEndpoint: string;
  private _browserProcess: any = null;
  private _browser: any;
  private _browserContext: any;
  private _wsEndpoint: string;
  private _waitingForServerConnection = true;
  private _ready = false;

  constructor(params: LeaderParams) {
    this._params = params;
    // this._browserWsEndpoint =
    // params.browserWsEndpoint || "ws://localhost:9222/0000";

    // this._isRemoteBrowser = !!params.browserWsEndpoint;

    this._wsEndpoint = params.wsEndpoint || "ws://127.0.0.1:8080";
  }

  // getters
  get browser() {
    return this._browser;
  }

  get browserContext() {
    return this._browserContext;
  }

  async stop() {
    
  }

  async start() {

    const options: Options = {
      browser: "chromium",
      loadStorage: this._params.storage,
    }

    const { browser, context, launchOptions, contextOptions} = await launchContext(options, false);
    
    this._browser = browser;
    this._browserContext = context;

    await this._browserContext._enableRecorder(
      {
        language: "javascript",
        launchOptions,
        contextOptions,
        device: options.device,
        saveStorage: options.saveStorage,
        mode: "recording", 
        outputFile: this._params.recorderOutputPath,
        handleSIGINT: false,
        leaderWSEndpoint: this._wsEndpoint,
      }
    )
  }

  static spawnProcess(params: LeaderParams) {
    const wsEndpoint = params.wsEndpoint || "ws://127.0.0.1:8080";

    const leader = spawn("npx", [
      "playwright",
      "mirror-leader",
      params.url ? params.url : "",
      `--leader-ws-endpoint`,
      wsEndpoint,
      params.storage ? `--load-storage=${params.storage}` : "",
      // `--browser-ws-endpoint ${params.browserWsEndpoint}`,
    ]);

    leader.stdout.on("data", (data) => {
      console.log(`[leader]: ${data}`);
    });

    leader.stderr.on("data", (data) => {
      console.log(`[leader] ERROR: ${data}`);
    });

    leader.on("close", (code) => {
      console.log(`[leader] exited with code ${code}`);
    });

    return leader;
  }
}

export default Leader;
