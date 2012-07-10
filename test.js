var context = require('rabbit.js').createContext();
context.on('ready', function() {
  var pub = context.socket('PUB'), sub = context.socket('SUB');
  sub.on('data', function(note) { console.log("Received:" + note); });
  sub.connect('test', function() {
    pub.connect('test', function() {
      pub.write('message sent from remote server via code! woot!', 'utf8');
    });
  });
});
