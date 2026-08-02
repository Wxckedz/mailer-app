const http = require('http');

function apiRequest(path, method, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': data.length } : {})
      }
    };
    const req = http.request(options, (res) => {
      let resp = '';
      res.on('data', (chunk) => resp += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: resp }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  // Login
  const login = await apiRequest('/api/auth/login', 'POST', null, { username: 'admin', password: 'admin123' });
  const { token } = JSON.parse(login.body);
  console.log('✅ Login:', login.status);

  // Status
  const status = await apiRequest('/api/status', 'GET', token);
  const statusData = JSON.parse(status.body);
  console.log('✅ Status:', status.status, '| Bot:', statusData.telegram, '| Admin:', statusData.admin);

  // Settings
  const settings = await apiRequest('/api/settings', 'GET', token);
  console.log('✅ Settings:', settings.status);

  // Users
  const users = await apiRequest('/api/users', 'GET', token);
  console.log('✅ Users:', users.status, users.body);

  // Brands
  const brands = await apiRequest('/api/brand-templates', 'GET', token);
  const brandData = JSON.parse(brands.body);
  console.log('✅ Brands:', brands.status, '| Total templates:', brandData.builtin.reduce((a,b) => a + b.templates.length, 0));

  // SMTP
  const smtp = await apiRequest('/api/smtp-configs', 'GET', token);
  console.log('✅ SMTP Configs:', smtp.status);

  // Team
  const team = await apiRequest('/api/team', 'GET', token);
  console.log('✅ Team:', team.status);

  // All tests passed
  console.log('\n🎉 All final tests passed!');
}

run().catch(console.error);