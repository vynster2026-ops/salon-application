const fs = require('fs');
const dbFile = 'db.json';

let db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));

if (!db.bookings) {
  db.bookings = [];
}

const serviceIds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
const clients = db.clients.slice(0, 50).map(c => c.name);

const now = new Date();
const past90Days = 90 * 24 * 60 * 60 * 1000;

// Generate 200 random bookings
for (let i = 0; i < 200; i++) {
  const randomTime = now.getTime() - Math.floor(Math.random() * past90Days);
  const dateStr = new Date(randomTime).toISOString();
  
  // 1 to 3 services
  const numServices = Math.floor(Math.random() * 3) + 1;
  const svcs = [];
  for (let j = 0; j < numServices; j++) {
    svcs.push(serviceIds[Math.floor(Math.random() * serviceIds.length)]);
  }

  const clientName = clients[Math.floor(Math.random() * clients.length)];
  
  db.bookings.push({
    id: 'b' + (Math.floor(Math.random() * 1000000)),
    date: dateStr,
    services: svcs,
    client: clientName,
    status: 'completed',
    staff: 'priya' // analytics page filters or maybe not, but assigning to priya is good
  });
}

// Ensure there is some data for 'sana' as well if needed
for (let i = 0; i < 50; i++) {
  const randomTime = now.getTime() - Math.floor(Math.random() * past90Days);
  const dateStr = new Date(randomTime).toISOString();
  const svcs = [serviceIds[Math.floor(Math.random() * serviceIds.length)]];
  const clientName = clients[Math.floor(Math.random() * clients.length)];
  
  db.bookings.push({
    id: 'b' + (Math.floor(Math.random() * 1000000)),
    date: dateStr,
    services: svcs,
    client: clientName,
    status: 'completed',
    staff: 'sana'
  });
}

fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
console.log('Added ' + db.bookings.length + ' dummy bookings to db.json');
