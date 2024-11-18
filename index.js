const express = require('express');
const apiRouter = require('./routers/api-routes');
const { router: authRouter } = require('./routers/auth-routes');
const cookiePaser = require('cookie-parser');
const cors = require('cors');

const port = process.env.PORT || 3000;
const app = express();

app.use(express.json());
app.use('/api', apiRouter);
app.use('/auth', authRouter);
app.use(cookiePaser());
app.use(cors());

app.get('/', (req, res) => {
    const cookie = req.cookies;
    res.send({
        message: 'welcome',
        cookie
    });
});

app.listen(port, () => {
    console.log('Server is running on port 3000');
});