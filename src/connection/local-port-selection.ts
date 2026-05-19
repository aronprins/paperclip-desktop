import net from "node:net";

export type LocalServerBindHost = "127.0.0.1" | "0.0.0.0";

export function bindHostForLocalExposure(exposeOnLocalNetwork: boolean): LocalServerBindHost {
  return exposeOnLocalNetwork ? "0.0.0.0" : "127.0.0.1";
}

export function bindHostsForLocalExposure(exposeOnLocalNetwork: boolean): LocalServerBindHost[] {
  return exposeOnLocalNetwork ? ["0.0.0.0", "127.0.0.1"] : ["127.0.0.1", "0.0.0.0"];
}

export function isPortAvailableForHost(port: number, host: LocalServerBindHost): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const settle = (available: boolean) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };

    server.once("error", () => {
      settle(false);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => settle(true));
    });
  });
}

export async function isPortAvailableForLocalExposure(
  port: number,
  exposeOnLocalNetwork: boolean,
): Promise<boolean> {
  for (const host of bindHostsForLocalExposure(exposeOnLocalNetwork)) {
    if (!(await isPortAvailableForHost(port, host))) {
      return false;
    }
  }

  return true;
}

export async function findFreePortForHost(
  startPort: number,
  host: LocalServerBindHost,
  maxAttempts = 100,
): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await isPortAvailableForHost(port, host)) {
      return port;
    }
  }

  throw new Error(`No free port found on ${host} in range ${startPort}-${startPort + maxAttempts - 1}`);
}

export async function findFreePortForLocalExposure(
  startPort: number,
  exposeOnLocalNetwork: boolean,
  maxAttempts = 100,
): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await isPortAvailableForLocalExposure(port, exposeOnLocalNetwork)) {
      return port;
    }
  }

  const hosts = bindHostsForLocalExposure(exposeOnLocalNetwork).join(", ");
  throw new Error(`No free port found on ${hosts} in range ${startPort}-${startPort + maxAttempts - 1}`);
}
