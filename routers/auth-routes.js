const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');
const env = require('dotenv');
const cookieParser = require('cookie-parser');
const cors = require('cors');

env.config();

const router = express.Router();
const corsOptions = {
    origin: 'http://localhost:4200',
    credentials: true
};

router.use(express.json());
router.use(cookieParser());
router.use(cors(corsOptions));

const dbName = process.env.DB_NAME;
const client = new MongoClient(process.env.MONGO_URI);

const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.send(false);
    }
    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        console.log(err);
        res.send(false);
    }
};

const verifyAdmin = async (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        console.log('no token');
        return res.send(false);
    }
    try {
        const { email } = jwt.verify(token, process.env.JWT_SECRET);
        await client.connect();
        const user = await client.db(dbName).collection('users').findOne({ email });
        if (user.role === 'admin') {
            next();
        } else {
            res.send({ message: 'unauthorized' });
        }
    } catch (err) {
        console.log(err);
        res.send(false);
    }
};

router.post('/register', async (req, res) => {
    const { fname, lname, email, password } = req.body;
    try {
        await client.connect();
        const invalidEmail = await client.db(dbName).collection('users').findOne({ email });
        if (invalidEmail) {
            res.send({
                message: 'email already exists'
            });
        } else {
            const hashedPassword = bcrypt.hashSync(password, process.env.BCRYPT_SALT);
            const lastRegister = await client.db(dbName).collection('users').find().sort({ memberId: -1 }).limit(1).toArray();
            const maxID = lastRegister.length > 0 ? lastRegister[0].memberId : 0;
            const user = { memberId: maxID + 1, fname, lname, email, password: hashedPassword, balance: 0, role: 'user' };
            const result = await client.db(dbName).collection('users').insertOne(user);
            res.send({
                message: 'registration successful',
            });
        }
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await client.connect();
        const user = await client.db(dbName).collection('users').findOne({ email });
        if (user && bcrypt.compareSync(password, user.password)) {
            const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
            res.cookie('token', token, { maxAge: 3600000, httpOnly: true });
            res.send({
                message: 'login successful',
                token
            });
        } else {
            res.send({
                message: 'login failed'
            });
        }
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.send({
        message: 'logout successful'
    });
});

exports.router = router;
exports.verifyToken = verifyToken;
exports.verifyAdmin = verifyAdmin;