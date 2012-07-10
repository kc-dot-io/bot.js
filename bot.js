console.log("Bot Started...")

var spawn = require('child_process').spawn,
  kill = require('child_process').kill,
  irc = require('irc'),
  gh = require('github'),
  github = new gh({ version: '3.0.0' }),
  config = require('./config'),
  rabbit = require('rabbit.js').createContext();

var BOT = {};
  BOT.server_name = 'irc.freenode.net',
  BOT.nick_name = ( ( typeof process.argv[2] != "undefined") ? process.argv[2] : 'sLBot' ),
  BOT.channel_name = ( ( typeof process.argv[3] != "undefined") ? '#'+process.argv[3] : '#slajax' ),
  BOT.channel_pass = ( (typeof process.argv[4] != "undefined" && process.argv[4] != 'false') ? process.argv[4] : '' ),
  BOT.child_process = ( (typeof process.argv[5] == "undefined" ) ? false : true ),
  BOT.child_prefix = ( ( BOT.channel_name.indexOf('test') > -1 ) ? 'dev-' : '' ),
  BOT.debug = true,
  BOT.git_user = config.git_user,
  BOT.git_pass = config.git_pass,
  BOT.children = [],
  BOT.subscriptions = [];

  console.log(BOT.nick_name+' channel:', BOT.channel_name);
  console.log(BOT.nick_name+' child:', BOT.child_process);
  console.log(BOT.nick_name+' pid:', process.pid);

  // wait for rabbitmq connected
  rabbit.on('ready', function(){

    var pub = rabbit.socket('PUB'), sub = rabbit.socket('SUB');
    sub.on('data',function(msg){
      var uid = this._privateQueue.currentMessage.exchange;

      for( var i=0; i<BOT.subscriptions.length; i++) {
        if( BOT.subscriptions[i].uid.indexOf(uid) > -1 ) {
          BOT.subscriptions[i].callback.apply( BOT.subscriptions[i], [ msg ]);
        }
      }

    });

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

      var user = ( typeof args[0] != 'undefined' ) ? args[0] : 'slajax';
      var repo = (typeof args[1] != 'undefined' ) ? args[1] : 'bot.js';

      github.authenticate({ type: 'basic', username: BOT.git_user, password: BOT.git_pass });
      github.events.getFromRepo({ user: user, repo: repo },
        function(err, commits) {

          if( err ) client.say(to, from+' - '+err);
          if( !commits || commits.length == 0 ) return;

          for( var i = 0; i<commits.length; i++ ) {
            if( commits[i].type == 'PushEvent' ) {
              var msg = "";
              github.gitdata.getCommit({ user: user, repo: repo, sha: commits[i].payload.commits[0].sha },
                function(err, commit) {

                  msg += commit.message+'\n';
                  msg += from+' - by '+commit.author.name+' <'+commit.author.email+'> at ';
                  msg += commit.author.date+'\n'+from+' - ';
                  msg += commit.url.replace('api.','').replace('repos/','').replace('git/commits/','commit/');

                  client.say(to, from+' - Last Commit: '+msg);

                });
              i = commits.length; break;
            }
          }
        });
    };

    BOT.API.dms = {};
    BOT.API.subscribe = function( to, from, msg, args )
    {
      var subscription = { uid: args[0], to: to, from: from, msg: msg, args: args };
      subscription.callback  = function( msg )
      {
        client.say(this.to, msg);
      };

      var found = false;
      for(var i=0; i< BOT.subscriptions.length; i++)
        if( BOT.subscriptions[i].uid == subscription.uid ) found = true;

      if( !found ) {
        BOT.subscriptions.push(subscription);
        sub.connect(args[0]);
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
        /*
         *if( BOT.subscriptions.length == 1 ) BOT.subscriptions = [];
         *else BOT.subscriptions = BOT.subscriptions.splice(found,1);
         */
        BOT.subscriptions[found].callback = function() {};
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
      var nick = ( args[0] ) ? args[0] : 'sLchildBot-'+BOT.children.length;
      var chan = ( args[1] ) ? args[1] : 'slajax';
      var pass = ( args[2] ) ? args[2] : '';

      var found = false;
      for( var i=0; i<BOT.children.length; i++)
        if( BOT.children[i].uid == args[0] ) found = true;

      if( !found ) {

        var bot = spawn( 'node', [ 'bot', nick, chan, pass, !BOT.child_process ] );
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
      var pass = ( args[1] ) ? args[1] : '';
      client.join('#'+args[0].replace('#','')+' '+pass);
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
  })

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
