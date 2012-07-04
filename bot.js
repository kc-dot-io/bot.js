console.log("Bot Started...")

var spawn = require('child_process').spawn,
  kill = require('child_process').kill,
  irc = require('irc'),
  gh = require('github'),
  github = new gh({ version: '3.0.0' }),
  zmq = require('zmq'),
  zmqSocket = zmq.socket('sub');
  //zmqSocket.connect('tcp://209.107.216.20:5556');

var BOT = {};
  BOT.server_name = 'irc.freenode.net',
  BOT.nick_name = ( ( typeof process.argv[2] != "undefined") ? process.argv[2] : 'sLBot' ),
  BOT.channel_name = ( ( typeof process.argv[3] != "undefined") ? '#'+process.argv[3] : '#slajax' ),
  BOT.channel_pass = ( (typeof process.argv[4] != "undefined" && process.argv[4] != 'false') ? process.argv[4] : '' ),
  BOT.child_process = ( (typeof process.argv[5] == "undefined" ) ? false : true ),
  BOT.child_prefix = ( ( BOT.channel_name.indexOf('test') > -1 ) ? 'dev-' : '' ),
  BOT.debug = true,
  BOT.git_user = '',
  BOT.git_pass = '',
  BOT.children = [],
  BOT.subscriptions = [];

  console.log(BOT.nick_name+' channel:', BOT.channel_name);
  console.log(BOT.nick_name+' child:', BOT.child_process);
  console.log(BOT.nick_name+' pid:', process.pid);

  /*
    BOT API for messaging interface
  */

  BOT.API = {};
  BOT.API.help = function( to, from, msg, args )
  {
    client.say(to, from+' - slajax! someone needs help!');
  };

  BOT.API.github = {};
  BOT.API.github.last = function( to, from, msg, args )
  {

    var user = 'slajax';
    var repo = 'bot.js';

    github.authenticate({ type: 'basic', username: BOT.git_user, password: BOT.git_pass });
    github.events.getFromRepo({ user: user, repo: repo },
      function(err, commits) {

        if( err ) client.say(to, from+' - '+err);
        if( commits.length == 0 ) return;

        for( var i = 0; i<commits.length; i++ ) {
          if( commits[i].type == 'PushEvent' ) {
            var msg = "";
            github.gitdata.getCommit({ user: user, repo: repo, sha: commits[i].payload.commits[0].sha },
              function(err, commit) {

                msg += commit.message+'\n';
                msg += from+' - by '+commit.author.name+' <'+commit.author.email+'> at ';
                msg += commit.author.date+'\n'+from+' - ';
                msg += commit.url.replace('api.','').replace('repos/','').replace('git/commits/','commit/');

                if( args[0] == "true") client.say(from, 'Last Commit: '+msg);
                else if( args[0] && args[0] != "true" ) client.say( args[0], 'Last Commit: '+msg);
                else client.say(to, from+' - Last Commit: '+msg);

              });
            i = commits.length; break;
          }
        }
      });
  };

  BOT.API.dms = {};
  BOT.API.subscribe = function( to, from, msg, args )
  {
    var subscription = { to: to, from: from, msg: msg, args: args };
    subscription.callback  = function( to, from, msg, args )
    {
      for (i = this.length-1; i >= 0; i--)
        arguments[i+1] = arguments[i].toString();

      arguments[0] = 'message';
      arguments.length += 1;

      var data = JSON.parse(arguments[2]);

      //console.log(data);

      var msg =  this.args[0]+' - '+data.sIdentifier+' - '+data.sIp
      if( typeof data.aData.REQUEST_URL != 'undefined') msg += ' - '+data.aData.REQUEST_URL;

      if( this.args[1] == "true" ) client.say(this.from, msg);
      else if ( this.args[1] && this.args[1] != "true" ) client.say(this.args[1], msg);
      else client.say(this.to, msg);
    };

    var found = false;
    subscription.uid = args[0];
    for(var i=0; i< BOT.subscriptions.length; i++)
      if( BOT.subscriptions[i].uid == subscription.uid ) found = true;

    if( !found ) {
      BOT.subscriptions.push(subscription);
      zmqSocket.subscribe(args[0]);
      client.say(to, from+' - subscribed to '+args[0]);
    } else {
      client.say(to, from+' - subscription exists: '+args[0]);
    }
  };
  BOT.API.unsubscribe = function( to, from, msg, args )
  {
    var found = false;
    for(var i=0; i<BOT.subscriptions.length; i++) {
      if( BOT.subscriptions[i].uid == args[0] ) found = i;
    }

    if( found || found === 0 && found !== false) {
      if( BOT.subscriptions.length == 1 ) BOT.subscriptions = [];
      else BOT.subscriptions = BOT.subscriptions.splice(found,1);
      zmqSocket.unsubscribe(args[0]);
      return client.say(to, from+' - unsubscribed to '+args[0]);
    } else {
      client.say(to, from+' - subscription not found: '+args[0]);
    }
  };
  BOT.API.list = function( to, from, msg, args )
  {
    if(BOT.subscriptions.length == 0) return client.say(to, from+' - no subscriptions exist');
    for( var i=0; i<BOT.subscriptions.length; i++ ) {
      client.say(to, from+' - '+BOT.subscriptions[i].uid );
    }
  };
  BOT.API.dms.subscribe = BOT.API.subscribe;
  BOT.API.dms.unsubscribe = BOT.API.unsubscribe;
  BOT.API.dms.list = BOT.API.list;

  BOT.API.ping = {};
  BOT.API.ping.all = function( to, from, msg, args )
  {
    var msg = 'ping ';
    var chankey = ( args[3] != false && args[0].indexOf(BOT.nick_name) == -1 ) ? args[3] : to;
    var channel = client.chans[ chankey ];
    for( var user in channel['users'] ) {
      if( user.toLowerCase() != BOT.nick_name.toLowerCase()
        && user.toLowerCase() != from.toLowerCase() ) msg += user+' ';
    }
    client.say(to, msg);
  };

  BOT.API.spawn = function( to, from, msg, args )
  {
    var nick = ( args[0] ) ? args[0] : 'childbot' ;
    var chan = ( args[1] ) ? args[1] : 'pinkbike' ;

    var found = false;
    for( var i=0; i<BOT.children.length; i++)
      if( BOT.children[i].uid == args[0] ) found = true;

    if( !found ) {

      var bot = spawn( 'node', [ 'bot', nick, chan, !BOT.child_process ] );
      client.say(to, 'spawning '+nick+' in #'+chan+' with pid: ' + bot.pid);
      console.log('spawning '+nick+' in #'+chan+' with pid: ' + bot.pid);
      BOT.children.push( { uid: nick, pid: bot.pid, proc: bot} );
      bot.stdout.on('data', function(data) {
        console.log( data.toString().replace('\n\n','\n') );
      });
    } else { client.say(to, 'child '+args[0]+' exists'); }
  };

  BOT.API.kill = function( to, from, msg, args )
  {
    var found = false;
    for( var i=0; i<BOT.children.length; i++) {
      if( BOT.children[i].uid == args[0] ) {
        BOT.children[i].proc.kill('SIGHUP');
        client.say(to, from+' - killed '+args[0]+' with pid: '+BOT.children[i].pid);
        found = true;
      }
    }
    if( found == false ) client.say(to, from+' - this bot is not in memory');
  };

  BOT.API.join = function( to, from, msg, args )
  {
    client.join('#'+args[0].replace('#',''));
    client.say(args[0], from+' - i am here!');
  };

  BOT.API.leave = function( to, from, msg, args )
  {
    client.say(args[0], from+' - '+BOT.nick_name+' is out! peace!');
    client.part('#'+args[0].replace('#',''));

  };

  /*
    Constructor for IRC connection and message handler / API interface
  */

  var client = new irc.Client(BOT.server_name, BOT.nick_name,
  {
    debug: BOT.debug
  });

  client.join(BOT.channel_name+' '+BOT.channel_pass);

  client.addListener('message', function( from, to, msg )
  {

    if( to.toLowerCase() == BOT.nick_name.toLowerCase() ) to = from;

    var args = msg.split(' ');
    for( var i = args.length; i<=10; i++ ) args.push(false);

    if( args[0].toLowerCase().indexOf( BOT.nick_name.toLowerCase() ) > -1
       || to.toLowerCase() == BOT.nick_name.toLowerCase() ) {

      var module = args[1];
      var action = args[2];

      if( typeof BOT.API[module] != 'undefined' && typeof BOT.API[module] == 'function' ) {
        var args = args.splice(2,args.length);
        return BOT.API[module].apply(BOT, [ to, from, msg, args ]);
      } else if(  typeof BOT.API[module] != 'undefined' && typeof BOT.API[module][action] == 'function' ) {
        var args = args.splice(3,args.length);
        return BOT.API[module][action].apply(BOT, [ to, from, msg, args ]);
      }

    }
  });


/*
 *  if( !BOT.child_process) {
 *
 *    client.join('#'+BOT.child_prefix+'sync');
 *    client.join('#'+BOT.child_prefix+'errors');
 *
 *    setTimeout(function(){
 *      BOT.API.spawn(BOT.channel_name, '', '', [ BOT.child_prefix+'sync', BOT.child_prefix+'sync']);
 *      BOT.API.spawn(BOT.channel_name, '', '', [ BOT.child_prefix+'errors', BOT.child_prefix+'errors']);
 *    }, 5000);
 *
 *    client.addListener('join', function(channel, nick, message) {
 *      if( nick == BOT.child_prefix+'errors' ) client.say(channel, BOT.child_prefix+'errors subscribe DMS-***PHP***');
 *      if( nick == BOT.child_prefix+'sync' ) client.say(channel, BOT.child_prefix+'sync subscribe DMS-system-sync');
 *    });
 *  }
 */

/*
 *  zmqSocket.on('message', function() {
 *    for (i = arguments.length-1; i >= 0; i--) {
 *        arguments[i+1] = arguments[i].toString();
 *    }
 *    arguments[0] = 'message';
 *    arguments.length += 1;
 *
 *    for( var i=0; i<BOT.subscriptions.length; i++) {
 *
 *      if( BOT.subscriptions[i].uid.indexOf(arguments[1].replace('-C','') ) > -1 ) {
 *        BOT.subscriptions[i].callback.apply( BOT.subscriptions[i], arguments);
 *      }
 *    }
 *  });
 */
