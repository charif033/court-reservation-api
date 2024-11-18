const express = require('express');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const env = require('dotenv');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { verifyToken } = require('./auth-routes');
const { verifyAdmin } = require('./auth-routes');

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

router.get('/isLoggedIn', verifyToken, (req, res) => {
    return res.send(true);
});

// top up
router.post('/topup', verifyAdmin, async (req, res) => {
    const { memberId, amount } = req.body;
    const date = new Date();
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const userBalance = await client.db(dbName).collection('users').findOne({ memberId }, { projection: { _id: 0, balance: 1 } });
        if (userBalance.balance + amount < 0) {
            return res.send({
                message: 'cannot top up'
            });
        }
        await client.db(dbName).collection('users').updateOne({ memberId }, { $inc: { balance: amount } });
        await client.db(dbName).collection('transaction').insertOne({ date, memberId, amount });
        res.send({
            message: 'top up successful'
        });
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// reservation court
router.post('/reservation', verifyToken, async (req, res) => {
    let { memberId, courtNo, date, time } = req.body;
    date = new Date(date);
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const reservationCheck = await client.db(dbName).collection('reservation').findOne({ courtNo, date, time });
        if (reservationCheck) {
            return res.send({
                message: 'unable to reserve'
            });
        }
        const userCheck = await client.db(dbName).collection('users').findOne({ memberId });
        if (userCheck.role !== 'admin') {
            if (userCheck.balance < 200) {
                return res.send({
                    message: 'not enough money'
                });
            }
            await client.db(dbName).collection('users').updateOne({ memberId }, { $inc: { balance: -200 } });
        }
        const reservation = { memberId, courtNo, date, time };
        await client.db(dbName).collection('reservation').insertOne(reservation);
        res.send({
            message: 'reservation successful',
        });
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// get court status by date
router.post('/courtStatus', async (req, res) => {
    let { date } = req.body;
    date = new Date(date);
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const courts = await client.db(dbName).collection('reservation').aggregate([
            { $match: { date: date } },
            { $project: { _id: 0, memberId: 1, courtNo: 1, time: 1 } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'memberId',
                    foreignField: 'memberId',
                    as: 'memberName',
                    pipeline: [{ $project: { _id: 0, fname: 1, lname: 1 } }]
                }
            },
            { $unwind: '$memberName' },
            { $group: { _id: '$courtNo', reservation: { $push: { time: '$time', memberName: '$memberName' } } } },
            { $sort: { courtNo: 1 } }
        ]).toArray();
        const timeIndex = {
            '15:00': 0,
            '16:00': 1,
            '17:00': 2,
            '18:00': 3,
            '19:00': 4,
            '20:00': 5
        }
        const courtStatus = [];
        for (let i = 0; i < 5; i++) {
            courtStatus.push([]);
            for (let j = 0; j < 6; j++) {
                courtStatus[i].push(false);
            }
        }
        for (let i = 0; i < courts.length; i++) {
            for (let j = 0; j < courts[i].reservation.length; j++) {
                courtStatus[courts[i]._id - 1][timeIndex[courts[i].reservation[j].time]] = courts[i].reservation[j].memberName;
            }
        }
        res.send(courtStatus);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

//get user info
router.get('/userInfo', async (req, res) => {
    const token = req.cookies?.token;
    const client = new MongoClient(process.env.MONGO_URI);
    if (!token) {
        return res.send({
            message: 'not logged in'
        });
    }
    const { email } = jwt.verify(token, process.env.JWT_SECRET);
    try {
        await client.connect();
        const user = await client.db(dbName).collection('users').aggregate([
            { $match: { email } },
            { $project: { _id: 0, memberId: 1, fname: 1, lname: 1, email: 1, balance: 1, role: 1 } },
            {
                $lookup: {
                    from: 'reservation',
                    localField: 'memberId',
                    foreignField: 'memberId',
                    as: 'reservation',
                    pipeline: [
                        { $project: { _id: 0, date: 1, time: 1, courtNo: 1 } },
                        { $limit: 5 }
                    ]
                }
            },
        ]).toArray();
        res.send(user);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

//get transaction history
router.get('/transaction', async (req, res) => {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const transactions = await client.db(dbName).collection('transaction').aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'memberId',
                    foreignField: 'memberId',
                    as: 'memberName',
                    pipeline: [{ $project: { _id: 0, fname: 1, lname: 1 } }]
                }
            },
            {
                $sort: { "date": -1 }
            }
        ]).toArray();
        res.send(transactions);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// get reservation history
router.get('/reservationHistory', async (req, res) => {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const reservations = await client.db(dbName).collection('reservation').aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'memberId',
                    foreignField: 'memberId',
                    as: 'memberName',
                    pipeline: [{ $project: { _id: 0, fname: 1, lname: 1 } }]
                }
            },
            {
                $sort: { "date": -1 }
            }

        ]).toArray();
        res.send(reservations);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

//get personal reservation history
router.get('/personalReservationHistory', async (req, res) => {
    const token = req.cookies?.token;
    const client = new MongoClient(process.env.MONGO_URI);
    if (!token) {
        return res.send({
            message: 'not logged in'
        });
    }
    const { email } = jwt.verify(token, process.env.JWT_SECRET);
    try {
        await client.connect();
        const { memberId } = await client.db(dbName).collection('users').findOne({ email });
        const reservations = await client.db(dbName).collection('reservation').find({ memberId }).toArray();
        res.send(reservations);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// send feedback
router.post('/feedback', async (req, res) => {
    const { name, email, memberId, feedback } = req.body;
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const result = await client.db(dbName).collection('feedback').insertOne({ name, email, memberId, feedback });
        res.send(result);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// get feedback
router.get('/feedback', async (req, res) => {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const feedback = await client.db(dbName).collection('feedback').find().toArray();
        res.send(feedback);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// user lookup by id
router.post('/userLookup', async (req, res) => {
    const { memberId } = req.body;
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        const users = await client.db(dbName).collection('users').find({ memberId }, { projection: { _id: 0, fname: 1, lname: 1, balance: 1 } }).toArray();
        res.send(users);
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

// cancle reservation
router.post('/cancelReservation', verifyAdmin, async (req, res) => {
    const { id } = req.body;
    const client = new MongoClient(process.env.MONGO_URI);
    try {
        await client.connect();
        await client.db(dbName).collection('reservation').deleteOne({ _id: new ObjectId(id) });
        res.send({ message: 'reservation cancelled' });
    } catch (err) {
        console.log(err);
    } finally {
        client.close();
    }
});

module.exports = router