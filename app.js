var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var mongoose = require('mongoose');
var logger = require('morgan');
var methodOverride = require('method-override');
var bodyParser = require('body-parser');
var multer = require('multer');
var multerS3 = require('multer-s3');
var passport= require('passport');
var session = require('express-session');
var flash = require('connect-flash');
var async = require('async');
var dotenv = require('dotenv');
const moment = require('moment');


var AWS = require('aws-sdk');
var fs = require('fs');
AWS.config.region = "ap-northeast-2";
var s3 = new AWS.S3();

var app = express();

dotenv.config();

mongoose.connect(process.env.MONGO_DB,{useNewUrlParser: true,useUnifiedTopology : true});
mongoose.set('userCreateIndex',true);

var db = mongoose.connection;

db.once("open",function(){
  console.log("DB connected!");
});

db.on("error",function(){
  console.log("DB ERROR :",err);
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use(cookieParser());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, 'public')));
app.use(flash());

app.use(session({secret:'MySecret', resave: true, saveUninitialized: true}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(user, done) {
    done(null, user.id);
});
passport.deserializeUser(function(id, done) {
    User.findById(id, function(err, user) {
        done(err, user);
    });
});

var LocalStrategy = require('passport-local').Strategy;
passport.use('local-login',
    new LocalStrategy({
            usernameField : 'email',
            passwordField : 'password',
            passReqToCallback : true
        },
        function(req, email, password, done) {
            User.findOne({ 'email' :  email }, function(err, user) {
                if (err) return done(err);

                if (!user){
                    req.flash("email", req.body.email);
                    return done(null, false, req.flash('loginError', 'No user found.'));
                }
                if (!user.authenticate(password)){
                    req.flash("email", req.body.email);
                    return done(null, false, req.flash('loginError', 'Password does not Match.'));
                }
                return done(null, user);
            });
        }
    )
);

var bcrypt = require('bcrypt-nodejs');
var userSchema = mongoose.Schema({
  email: {type:String, required:true, unique:true},
  nickname: {type:String, required:true, unique:true},
  password: {type:String, required:true},
  createdAt: {type:Date, default:Date.now}
});

userSchema.pre('save', function(next){
    var user = this;
    if(!user.isModified('password')){
        return next();
    } else{
        user.password = bcrypt.hashSync(user.password);
        return next();
    }
});
userSchema.methods.authenticate = function(password){
    var user = this;
    return bcrypt.compareSync(password, user.password);
};
userSchema.methods.hash = function (password){
    return bcrypt.hashSync(password);
};
var User = mongoose.model('user',userSchema);

var adSchema = mongoose.Schema({
    corp_name : {type:String},
    name : {type:String, required:true},
    email : {type:String, required:true},
    phone : {type:String, required:true},
    description : String,
    type : {type:String, required:true},
    createdAt : {type:Date, default : Date.now},
    imageFileName : [{type:String, default : "none"}]

});
var Ad = mongoose.model('ad',adSchema);

var noticeSchema = mongoose.Schema({
    title : {type:String, required:true},
    body : {type:String, required: true},
    createdAt : {type:Date, default:Date.now},
    updatedAt : Date
});
var Notice = mongoose.model('notice',noticeSchema);

var qnaSchema = mongoose.Schema({
    title : {type:String, required:true},
    body : {type:String, required: true},
    createdAt : {type:Date, default:Date.now},
});
var Qna = mongoose.model('qna',qnaSchema);

var askSchema = mongoose.Schema({
    selected_kind : {type : String, require : true},
    title : {type : String, require : true},
    body : {type : String, require : true},
    imageFileName : String,
    createdAt : {type:Date, default : Date.now}
});
var Ask = mongoose.model('ask',askSchema);

app.get('/', function(req,res){
  console.log("index.ejs");
    Notice.find({}).sort('-createdAt').exec(function (err,notices){
        if(err) return res.json({success:false, message:err});
        res.render("index", {data:notices, user:req.user, subtitle : "index"});
    });
});

app.get('/notice', function(req,res){
  console.log("notice.ejs");
  var page = Math.max(1,req.query.page);
  var limit = 10;
  Notice.count({},function(err,count){
      if(err) return res.json({success : false, message:err});
      var skip = (page-1)*limit;
      var maxPage = Math.ceil(count/limit);
      var count = count;
      Notice.find({}).sort('-createdAt').skip(skip).limit(limit).exec(function (err,notices){
          if(err) return res.json({success:false, message:err});
          res.render("notice", {data:notices,count : count ,page : page, maxPage : maxPage, user:req.user, subtitle : "공지사항", moment: moment});
      });
  });
});

app.get('/notice/:id', function(req,res){
    Notice.findById(req.params.id, function (err,notices) {
        if(err) return res.json({success:false, message:err});
        console.log(notices);
        res.render("notice_show", {subtitle : "공지사항" , data:notices});
    });
}); // show

app.get('/about', function(req,res){
  console.log("about.ejs");
  res.render("about",{subtitle : "베네픽쳐"});
});

app.get('/contact', function(req,res){
  console.log("contact.ejs");
  res.render("contact",{subtitle : "CONTACT US"});
});

// app.get('/qna', function(req,res){
//   Qna.find({}).sort('-createdAt').exec(function (err,qnas){
//       if(err) return res.json({success:false, message:err});
//       res.render("qna",{subtitle : "FAQ",data:qnas});
//   });
// });

app.get('/question', function(req,res){
    console.log("question.ejs");
    res.render("question",{subtitle : "광고 신청", thanks : ""});
});

app.get('/ask', function(req,res){
    console.log("ask.ejs");
    res.render("ask",{subtitle : "문의하기", thanks : ""});
});
var imageFileName;
var imageNumber=0;
var imageArray = new Array();
let upload = multer({
    storage : multerS3({
        s3: s3,
        bucket : "benepicturead",
        contentType : multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            console.log(file);
            imageFileName = imageNumber+"aa"+Date.now().toString() + file.originalname;
            imageArray[imageNumber] = imageFileName;
            imageNumber++;
            console.log(imageFileName + " imageNumber : "+imageNumber);
            cb(null, imageFileName);
        },
        acl : "public-read"
    })

});

app.post('/question', upload.array('image'), function(req,res){
    Ad.create(req.body,function(err,ad){n
        if(err) return res.json({success:false, message:err});
        ad.imageFileName = imageArray;
        imageNumber = 0;
        ad.save();
        console.log("ad : " + ad);
        res.render("question",{subtitle : "광고 신청", thanks : "베네픽쳐와 함께 해주셔서 감사합니다."});
    });
});

let uploadAsk = multer({
    storage : multerS3({
        s3: s3,
        bucket : "benepictureask",
        contentType : multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            console.log(file);
            imageFileName = Date.now().toString() + file.originalname;
            console.log(imageFileName);
            cb(null, imageFileName);
        },
        acl : "public-read"
    })

});

app.post('/ask',uploadAsk.array('image'),function(req,res){
    Ask.create(req.body, function(err,ask){
        if(err) return res.json({success:false, message:err});
        ask.imageFileName = imageFileName;
        ask.save();
        res.render("ask",{subtitle : "문의하기", thanks : "여러분의 소중한 의견 감사합니다."});
    });
});

app.get('/login', function(req,res){
  res.render("login",{email:req.flash("email")[0], loginError:req.flash('loginError')});
});

app.post('/login',
    function (req,res,next){
      req.flash("email");
      if(req.body.email.length == 0 || req.body.password.length == 0){
        req.flash("email", req.body.email);
        req.flash("loginError","Please enter both email and password.");
        res.redirect('/login');
      }
      else{
        next();
      }
    }, passport.authenticate('local-login',{
      successRedirect : '/posts',
      failureRedirect : '/login',
      failureFlash : true
    })
);

app.get('/logout', function(req, res){
  req.logout();
  res.redirect('/login');
});


app.get('/users/new', function(req,res){
  res.render('users/new', {
        formData: req.flash('formData')[0],
        emailError: req.flash('emailError')[0],
        nicknameError: req.flash('nicknameError')[0],
        passwordError: req.flash('passwordError')[0]
      }
  );
}); // new
app.post('/users', function(req,res,next){
    console.log(req.body.user);
  User.create(req.body.user, function (err,user) {
    if(err) return res.json({success:false, message:err});
    res.redirect('/login');
  });
});

app.get('/users/:id', isLoggedIn, function(req,res){
  User.findById(req.params.id, function(err,user){
    if(err) return res.json({success:false, message:err});
    res.render('users/show', {user: user});
  });
});

app.put('/users/:id', isLoggedIn, checkUserRegValidation, function(req,res){
  User.findById(req.params.id, req.body.user, function(err,user){
    if(err) return res.json({success:'false', message:err});
    if(user.authenticate(password)){
      if(req.body.user.newPassword){
        req.body.user.password = user.hash(req.body.user.newPassword);
      }else{
        delete req.body.user.password;
      }
      User.findByIdAndUpdate(req.params.id, req.body.user, function(err, user){
        if(err) return res.json({success: "false", message:err});
        res.redirect("/users/"+req.params.id);
      });
    } else{
      req.flash("formData", req.body.user);
      req.flash("passwordError", "- Invalid password");
      res.redirect("/users/"+req.params.id+"/edit");
    }
  });
});

app.get('/users/:id/edit', isLoggedIn, function(req,res){
  User.findById(req.params.id, function(err,user){
    if(err) return res.json({success:false, message:err});
    res.render('users/edit',{
      user: user,
      formData : req.flash('formData')[0],
      emailError : req.flash('emailError')[0],
      nicknameError : req.flash('nicknameError')[0],
      passwordError : req.flash('passwordError')[0]
    }
    );
  });
});

app.get('/posts', isLoggedIn, function(req,res){
    Notice.find({}).sort('-createdAt').exec(function (err,notices) {
        Qna.find({}).sort('-createdAt').exec(function (err,qnas){
        if(err) return res.json({success:false, message:err});
        res.render("posts/index", {data:notices, user:req.user,qna:qnas});
        });
    });
}); // index

app.get('/posts/ads', isLoggedIn, function(req,res){
    Ad.find({}).sort('-createdAt').exec(function (err,ads){
        if(err) return res.json({success:false, message:err});
        res.render("posts/ads",{data:ads, user:req.user});
    });
});

app.get('/posts/asks', isLoggedIn, function(req,res){
    Ask.find({}).sort('-createdAt').exec(function (err,asks){
        if(err) return res.json({success:false, message:err});
        res.render("posts/asks",{data:asks, user:req.user});
    });
});

app.get('/posts/new', isLoggedIn, function(req,res){
    res.render("posts/new");
}); // new
app.post('/posts/notice', isLoggedIn, function(req,res){
    console.log(req.body);
    Notice.create(req.body.post,function (err,post) {
        if(err) return res.json({success:false, message:err});
        res.redirect('/posts');
    });
}); // create
app.post('/posts/qna', isLoggedIn, function(req,res){
    console.log(req.body);
    Qna.create(req.body.post,function (err,post) {
        if(err) return res.json({success:false, message:err});
        res.redirect('/posts');
    });
}); // create
app.get('/posts/:id', isLoggedIn, function(req,res){
    Notice.findById(req.params.id, function (err,notice) {
        if(err) return res.json({success:false, message:err});

        else if(notice == null) {
            Qna.findById(req.params.id, function(err,qna){
                if(err) return res.json({success:false, message:err});
                res.render("posts/show", {data: qna});
            });
        }
        else {
            res.render("posts/show", {data: notice});
        }
    });
}); // show
app.get('/posts/:id/edit', isLoggedIn, function(req,res){
    Notice.findById(req.params.id, function (err,notice) {
        if(err) return res.json({success:false, message:err});

        else if(notice == null) {
            Qna.findById(req.params.id, function(err,qna){
                if(err) return res.json({success:false, message:err});
                res.render("posts/edit", {data: qna});
            });
        }
        else {
            res.render("posts/edit", {data: notice});
        }
    });
}); // edit

app.put('/posts/:id', isLoggedIn, function(req,res){
    Notice.findByIdAndUpdate(req.params.id, req.body.post, function(err, notice){
        if(err) return res.json({success:false, message:err});

        else if(notice == null){
            Qna.findByIdAndUpdate(req.params.id, req.body.post, function(err, qna){
                if(err) return res.json({success:false, message:err});
                res.redirect("/posts");
            });
        }

        else{
            res.redirect("/posts");
        }

    });
});


app.delete('/posts/:id', isLoggedIn, function(req,res){
    Notice.findByIdAndRemove(req.params.id, function (err,notice) {
        if(err) return res.json({success:false, message:err});

        else if(notice == null) {
            Qna.findByIdAndRemove(req.params.id, function(err,qna){
                if(err) return res.json({success:false, message:err});
                res.redirect("/posts");
            });
        }
        else {
            res.redirect("/posts");
        }
    });
}); //destroy

function isLoggedIn(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }
    res.redirect('/');
}

function checkUserRegValidation(req, res, next) {
    var isValid = true;

    async.waterfall(
        [function(callback) {
            User.findOne({email: req.body.user.email, _id: {$ne: mongoose.Types.ObjectId(req.params.id)}},
                function(err,user){
                    if(user){
                        isValid = false;
                        req.flash("emailError","- This email is already resistered.");
                    }
                    callback(null, isValid);
                }
            );
        }, function(isValid, callback) {
            User.findOne({nickname: req.body.user.nickname, _id: {$ne: mongoose.Types.ObjectId(req.params.id)}},
                function(err,user){
                    if(user){
                        isValid = false;
                        req.flash("nicknameError","- This nickname is already resistered.");
                    }
                    callback(null, isValid);
                }
            );
        }], function(err, isValid) {
            if(err) return res.json({success:"false", message:err});
            if(isValid){
                return next();
            } else {
                req.flash("formData",req.body.user);
                res.redirect("back");
            }
        }
    );
}
// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
