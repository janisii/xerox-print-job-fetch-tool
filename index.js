const devices = require("./devices");
const jobs = require("./jobs");

// Clear console
console.clear();

// Pull data from all devices
(async () => {
  for (const device of devices) {
    await jobs(device).catch(err => console.log(err.message));
  }
})();
