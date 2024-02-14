const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const app = express();
const port = 3000;
const dotenv = require('dotenv');

dotenv.config();

const { UserModel, LogsModel, UserIpModel } = require('./database');
const { getWeatherByCity, getNewsByCity, fetchMarvelCharacter} = require('./api');
const { getWindDirection, getCurrentTimeString } = require('./utils');

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('trust proxy', true)

// Index page
app.get('/', async (req, res) => {
    const user = await getUserInstance(req.ip);

    res.render('pages/index.ejs', { activePage: "home", user: user ? user : null, error: null });
});

app.get("/news", async (req, res) => {
    const news = await getNewsByCity();
    const user = await getUserInstance(req.ip);

    if (!news) {
        return res.render('pages/news.ejs', { activePage: "news", user: user, error: "Could not fetch news", data: null });
    }

    res.render('pages/news.ejs', { activePage: "news", user: user, data: news, error: null });
    LogsModel.create({ user: user ? user._id : null, request_type: "news", request_data: null, status_code: "200", timestamp: new Date(), response_data: JSON.stringify(news)});
});

// History page
app.get("/history", async (req, res) => {
    const user = await getUserInstance(req.ip);
    if (!user) {
        return res.status(303).redirect("/search");
    }

    const logs = await LogsModel.find({ user: user._id }).sort({ _id: -1 }).exec();
    res.render('pages/history.ejs', { activePage: "history", user: user, logs: logs, error: logs ? null : "No logs found"});
});

app.get("/history/:objectId", async (req, res) => {
    const objectId = req.params.objectId;
    const log = await LogsModel.findById(objectId).exec();
    try {
        if (!log) {
            return res.status(404).send("Log not found");
        }

        res.json(JSON.parse(log.response_data));
    } catch (error) {
        res.status(200).json({ data: log.response_data })
    }
});

app.get("/history/:objectId/delete", async (req, res) => {
    const user = await getUserInstance(req.ip);
    if (!user) {
        return res.status(303).redirect("/search");
    }

    const objectId = req.params.objectId;

    await LogsModel.findByIdAndDelete(objectId).exec();
    res.status(303).redirect("/history");
});

// Admin page
app.get("/admin", async (req, res) => {
    const user = await getUserInstance(req.ip);

    if (!user || !user.is_admin) {
        return res.status(303).redirect("/");
    }

    const allUsers = await UserModel.find().exec();

    res.render('pages/admin.ejs', { activePage: "admin", user: user, users: allUsers });
});

app.get("/admin/:userid/delete", async (req, res) => {
    const user = await getUserInstance(req.ip);

    if (!user || !user.is_admin) {
        return res.status(403).redirect("/");
    }

    const userId = req.params.userid;

    await UserModel.findByIdAndDelete(userId).exec();
    res.status(202).redirect("/admin");
});

app.get("/admin/:userid/makeAdmin", async (req, res) => {
    const user = await getUserInstance(req.ip);

    if (!user || !user.is_admin) {
        return res.status(403).redirect("/");
    }

    const userId = req.params.userid;

    await UserModel.findByIdAndUpdate(userId, { is_admin: true }).exec();
    res.status(202).redirect("/admin");
});

app.post("/admin/addUser", async (req, res) => {
    const { username, email, password, is_admin } = req.body;
    const user = await getUserInstance(req.ip);

    if (!user || !user.is_admin) {
        return res.status(403).redirect("/");
    }

    const userInstance = new UserModel({ username: username, email: email, password: password, is_admin: is_admin === "on" });
    await userInstance.save();

    res.status(202).redirect("/admin");
});

app.get("/admin/:username", async (req, res) => {
    const username = req.params.username;
    const user = await UserModel.findOne({ username: username }).exec();
    const history = await LogsModel.find({ user: user._id }).sort({ _id: -1 }).exec();

    res.render('pages/admin_user.ejs', { activePage: "admin", user: user, logs: history, error: history ? null : "No logs found"});
});

app.post('/admin/updateUser', async (req, res) => {
    const { userId, username, email, password } = req.body;
    await UserModel.findByIdAndUpdate(userId, { username, email, password });

    res.redirect('/admin');
});

// News page


app.use(bodyParser.urlencoded({ extended: true }));

app.get('/superheroes', async (req, res) => {
    const user = await getUserInstance(req.ip);
    try {
        const query = req.query.character || 'Iron Man'; // Default to Iron Man if no query provided
        const characterData = await fetchMarvelCharacter(query);
        res.render('pages/superheroes.ejs', {activePage: "superheroes", user: user, data: characterData, error: null});
    } catch (error) {
        res.status(500).render('error', { message: 'Error fetching data' });
    }
});

app.get("/news", async (req, res) => {
    const news = await getNewsByCity();
    const user = await getUserInstance(req.ip);

    if (!news) {
        return res.render('pages/news.ejs', { activePage: "news", user: user, error: "Could not fetch news", data: null });
    }

    res.render('pages/news.ejs', { activePage: "news", user: user, data: news, error: null });
    LogsModel.create({ user: user ? user._id : null, request_type: "news", request_data: null, status_code: "200", timestamp: new Date(), response_data: JSON.stringify(news)});
});

// Login page
app.get("/login", async (req, res) => {
    const user = await getUserInstance(req.ip);
    if (user) {
        return res.status(303).redirect("/");
    }

    res.render('pages/login.ejs', { activePage: "login", error: null, user: null });
});

app.post("/login", async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
        res.render('pages/login.ejs', { activePage: "login", error: "All fields are required", user: null });
        return;
    }

    let userInstance = await UserModel.findOne({ username: username }).exec();

    if (!userInstance) {
        res.render('pages/login.ejs', { activePage: "login", error: "User does not exist", user: null });
        return;
    }

    if (userInstance.password !== password) {
        LogsModel.create({ user: userInstance._id, request_type: "login", request_data: username, status_code: "401", timestamp: new Date(), response_data: "wrong password"});
        res.render('pages/login.ejs', { activePage: "login", error: "Password is incorrect", user: null });
        return;
    }


    await UserIpModel.create({ ip: req.ip, user: userInstance._id });
    res.status(303).redirect("/");
    LogsModel.create({ user: userInstance._id, request_type: "login", request_data: username, status_code: "200", timestamp: new Date(), response_data: "success"});
});

// Signup page
app.get("/signup", async (req, res) => {
    const user = await getUserInstance(req.ip);
    if (user) {
        return res.status(303).redirect("/");
    }

    res.render('pages/signup.ejs', { activePage: "signup", error: null, user: null });
});

app.post("/signup", async (req, res) => {
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;

    if (!username || !email || !password) {
        res.render('pages/signup.ejs', { activePage: "signup", error: "All fields are required", user: null });
        return;
    }

    let userInstance = await UserModel.findOne({ username: username }).exec();

    if (userInstance) {
        res.render('pages/signup.ejs', { activePage: "signup", error: "User already exists", user: null });
        return;
    }

    userInstance = new UserModel({ username: username, email: email, password: password });
    await userInstance.save();

    await UserIpModel.create({ ip: req.ip, user: userInstance._id });
    res.status(303).redirect("/");
    LogsModel.create({ user: userInstance._id, request_type: "signup", request_data: username, status_code: "200", timestamp: new Date(), response_data: "success"});
});

// Logout logic
app.get("/logout", async (req, res) => {
    await UserIpModel.findOneAndDelete({ ip: req.ip }).exec();
    res.status(303).redirect("/");
    LogsModel.create({ user: null, request_type: "logout", request_data: null, status_code: "200", timestamp: new Date(), response_data: "success"});
});

// Listening
app.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on ${port}`);
});


// Utils
async function getUserInstance(ip) {
    let username = await UserIpModel.findOne({ ip: ip }).exec();
    username = username ? username.user : null;

    let userInstance = null;
    if (username) {
        userInstance = await UserModel.findOne({ _id: username }).exec();
    }

    return userInstance;
}
