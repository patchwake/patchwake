const { acquireLock } = await import(process.argv[3]);
acquireLock(process.argv[2]);
process.send({ locked: true });
setInterval(() => {}, 1000);
