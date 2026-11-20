await import('./server/index.js');
process.on('message', (message) => {
  if (message === 'shutdown') process.emit('SIGTERM');
});
