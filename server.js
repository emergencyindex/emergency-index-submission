// server.js
const express = require('express');
const aws = require('aws-sdk');
const multer = require('multer');
const path = require('path');
const sizeOf = require('image-size');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

const spacesEndpoint = new aws.Endpoint('sfo2.digitaloceanspaces.com');
const s3 = new aws.S3({
  endpoint: spacesEndpoint
});

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, '/tmp')
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() +'_'+ file.originalname.replace(/[^A-Za-z0-9\.]/g,''))
    }
  }),
  fileFilter: function (req, file, cb) {
    const filetypes = /tif|tiff/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (!mimetype || !extname) {
      req.fileValidationError = "Error: Photo upload only supports .tif or .tiff files!";
      return cb(null, false, new Error(req.fileValidationError));
    }
    return cb(null, true);
  }
});

// http://expressjs.com/en/starter/static-files.html
app.use(express.static("build"));

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function(request, response) {
  response.sendFile(__dirname + "/build/index.html");
});

app.post('/photo', upload.single('photo'), function(req, res, next) {
  if(req.fileValidationError) {
    res.json({success: false, error: req.fileValidationError});
  } else {
    const d = sizeOf(req.file.path)
    const isInvalidSize = (d.width != 1500 && d.width != 2100) || (d.height != 1500 && d.height != 2100);
    if(isInvalidSize) {
      res.json({success: false, error: "Image needs to be 5x7 (1500x2100 pixels) or 7x5 inches (2100x1500 pixels). Your photo is "+d.width+"x"+d.height});
    } else {
      s3.upload({
        Bucket: 'emergencyindex',
        ACL: 'public-read',
        ContentType: req.file.mimetype,
        Key: `uploads/${req.file.filename}`,
        Body: fs.createReadStream(req.file.path)
      },function (err, data) {
      if (err) {
        res.json({success: false, error: "Error: " + err});
      } if (data) {
        fs.unlinkSync(req.file.path);
        res.json({success: true, data: data.Location});
      }})
    }
  }
});

app.post('/submit', function(req, res, next) {
  console.log('submit req.body:',req.body);
  const now = Date.now().toString()
  s3.upload({
    Bucket: 'emergencyindex',
    ACL: 'public-read',
    ContentType: 'application/json',
    Key: `${now}.json`,
    Body: JSON.stringify(req.body)
  },function (err, data) {
  if (err) {
    res.send({success: false, error: "Error: " + err});
  } if (data) {
    res.send({success: true, data: 'Thank You!'});
  }})
});

app.get('/submissions', function(req, res) {
  let keys = [];
  s3.listObjects({Bucket:'emergencyindex'})
  .on('success', function handlePage(item) {
    item.data.Contents.forEach(function(item) {
      if(item.Key.match(/.json/)){
        keys.push(item.Key);
      }
    })
    if(item.hasNextPage()) {
      // another page: handle it
      item.nextPage().on('success', handlePage).send();
    }
  }).on('error', function(err) {
      console.warn('o noz error:',err)
  }).on('complete', function() {
    // console.log('complete! keys:', keys);
    let promises = [];
    keys.forEach( function(k) {
      promises.push(
        new Promise(function(resolve, reject) {
          s3.getObject({
           Bucket: 'emergencyindex', 
           Key: k
          }, function(err, data) {
            if (err){
              console.warn(err, err.stack);
              resolve();
            } else {
              const project_form = JSON.parse(data.Body);
              // console.log('project_form.data', project_form.data)
              if (project_form.data && project_form.data.length > 0){
                resolve(project_form.data);
              }else{
                resolve();
              }
            }
          });
        })
      );
    });

    Promise.all(promises).then( function(data) {
      // console.log('promises data:', data);
      
      const json2csv = require('json2csv').parse;
      const fields = [
        'contact_name',
        'contact_email',
        'contact_postal',
        'contact_phone',
        'title',
        'contributor',
        'collaborators',
        'date_first_performed',
        'times_performed',
        'venue',
        'city',
        'state_country',
        'home',
        'published_contact',
        'links',
        'description',
        'photo_credit',
        'photoUrl',
        'already_submitted',
        'wants_to_get_involved',
        'wants_to_host',
        'validationError'
      ];
      try {
        const csv = json2csv(data, { fields });
        // console.log(csv);
        res.send(csv);
      } catch (err) {
        console.error('csv err:',err);
        res.json({error: err});
      }

      
    }).catch( function(err) {
      console.log('caught err', err)
      res.json({error: err});
    });
    
  }).send();

})

// listen for requests :D
const listener = app.listen(process.env.PORT, function() {
  console.log("Your app is listening on port " + listener.address().port);
});
