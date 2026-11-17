const { main } = require('./bot');

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
