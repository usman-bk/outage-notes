// Sits between the app and Postgres so a test can make the database vanish mid request,
// the way a real outage does, and can count how much the app actually asks it for.
import http from 'node:http';
import net from 'node:net';

const target = new URL(
  process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/outage_notes_e2e_test',
);
const dbPort = Number(process.env.E2E_PROXY_PORT ?? 55433);
const controlPort = Number(process.env.E2E_CONTROL_PORT ?? 55434);

let up = true;
let messages = 0;
const sockets = new Set();

net
  .createServer((client) => {
    if (!up) return client.destroy();
    const server = net.connect(Number(target.port || 5432), target.hostname);
    for (const socket of [client, server]) {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('data', () => (messages += 1));
    client.pipe(server);
    server.pipe(client);
    client.on('close', () => server.destroy());
    server.on('close', () => client.destroy());
  })
  .listen(dbPort, '127.0.0.1');

http
  .createServer((request, response) => {
    if (request.url === '/down') {
      up = false;
      for (const socket of sockets) socket.destroy();
    }
    if (request.url === '/up') up = true;
    response.end(JSON.stringify({ up, messages }));
  })
  .listen(controlPort, '127.0.0.1');
