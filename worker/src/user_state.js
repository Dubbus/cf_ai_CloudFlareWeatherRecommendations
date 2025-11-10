import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.data = { city: "", lat: 0, lon: 0, prefs: {} };
    // load persisted data (async) and keep the promise
    this._loaded = this.state.storage.get("data").then(d => {
      if (d) this.data = d;
    }).catch(() => {});
  }

  // Back-compat RPC
  async sayHello() {
    await this._loaded;
    return `hello from ${this.data.city || "durable"}`;
  }

  // Primary HTTP-style handler used by index.js via stub.fetch("https://do/state", ...)
  async fetch(req) {
    await this._loaded;
    const url = new URL(req.url);
    const path = url.pathname || "/";

    if (req.method === "POST" && path === "/state") {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {
        // ignore parse errors
      }
      // merge shallow
      Object.assign(this.data, body);
      await this.state.storage.put("data", this.data);
      return new Response(JSON.stringify(this.data), {
        headers: { "content-type": "application/json" }
      });
    }

    if ((req.method === "GET" || req.method === "HEAD") && path === "/state") {
      return new Response(JSON.stringify(this.data), {
        headers: { "content-type": "application/json" }
      });
    }

    // Back-compat RPC endpoint
    if (req.method === "GET" && path === "/sayHello") {
      return new Response(await this.sayHello(), { headers: { "content-type": "text/plain" } });
    }

    return new Response("Not Found", { status: 404 });
  }
}
