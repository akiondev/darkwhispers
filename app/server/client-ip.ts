import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

// Official Cloudflare proxy ranges, checked 2026-10-23:
// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
// A range change fails closed to the proxy's IP until this list is updated.
const proxies = new BlockList();
for (const range of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [address, bits] = range.split('/');
  proxies.addSubnet(address, Number(bits), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

export function clientAddress(request: Pick<FastifyRequest, 'ip' | 'headers'>): string {
  // Caddy sanitizes X-Forwarded-For; Fastify trusts only the loopback Caddy hop.
  // Do not trust CF-Connecting-IP when the immediate external peer is not Cloudflare.
  const family = isIP(request.ip);
  const visitor = request.headers['cf-connecting-ip'];
  if (
    family &&
    proxies.check(request.ip, family === 6 ? 'ipv6' : 'ipv4') &&
    typeof visitor === 'string' &&
    isIP(visitor)
  )
    return visitor;
  return request.ip;
}
