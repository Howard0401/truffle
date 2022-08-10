import type * as Hardhat from "hardhat/types";
import type * as Common from "@truffle/compile-common";
import findUp from "find-up";
import Config from "@truffle/config";
import { spawn } from "child_process";
import { promises as fs } from "fs";

import { buildInfoCompilation } from "./shims";

const validHardhatConfigFilenames = ["hardhat.config.js", "hardhat.config.ts"];

// import type * as Hardhat from "hardhat";

export async function detectHardhat(): Promise<boolean> {
  // search recursively up for a hardhat config
  const hardhatConfigPath = await findUp(validHardhatConfigFilenames);

  return !!hardhatConfigPath;
}

export async function prepareConfig(): Promise<Config> {
  const config = Config.default();

  const networks = (await askHardhatConsole(
    `hre.config.networks`
  )) as Hardhat.NetworksUserConfig;

  for (const [networkName, networkConfig] of Object.entries(networks)) {
    if (networkName === "hardhat") {
      continue;
    }

    if (networkConfig && "url" in networkConfig) {
      const { url } = networkConfig;
      config.networks[networkName] = {
        url,
        network_id: "*"
      };
    }
  }

  return config;
}

export async function prepareCompilations(): Promise<Common.Compilation[]> {
  const compilations = [];

  const buildInfoPaths = (await askHardhatConsole(
    `artifacts.getBuildInfoPaths()`
  )) as string[];

  for (const buildInfoPath of buildInfoPaths) {
    const buildInfo: Hardhat.BuildInfo = JSON.parse(
      (await fs.readFile(buildInfoPath)).toString()
    );

    const compilation = buildInfoCompilation(buildInfo);

    compilations.push(compilation);
  }

  return compilations;
}

interface AskHardhatConsoleOptions {
  // turn off json stringify/parse
  raw?: boolean;
}

async function askHardhatConsole(
  expression: string,
  options: AskHardhatConsoleOptions = {}
): Promise<string | unknown> {
  const { raw = false } = options;

  return new Promise((accept, reject) => {
    const hardhat = spawn(`npx`, ["hardhat", "console"], {
      stdio: ["pipe", "pipe", "inherit"]
    });

    // we'll capture the stdout
    let output = "";
    hardhat.stdout.on("data", data => {
      output = `${output}${data}`;
    });

    // setup close event before writing to stdin because we're sending eof
    hardhat.on("close", code => {
      if (code !== 0) {
        return reject(new Error(`Hardhat exited with non-zero code ${code}`));
      }

      if (raw) {
        return accept(output);
      }

      try {
        return accept(JSON.parse(output));
      } catch (error) {
        return reject(error);
      }
    });

    hardhat.stdin.write(`
      Promise.resolve(${expression})
        .then(${
          raw
            ? `console.log`
            : `(resolved) => console.log(JSON.stringify(resolved))`
        })
    `);
    hardhat.stdin.end();
  });
}
