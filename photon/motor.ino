// Motor 1 (Left)
int ena = A4;
int in1 = D0;
int in2 = D1;

// Motor 2 (Right)
int enb = A5;
int in3 = D2;
int in4 = D3;

unsigned long lastCommandTime = 0;
const unsigned long SAFETY_TIMEOUT = 2000;
bool motorsRunning = false;

void setup() {
    pinMode(ena, OUTPUT);
    pinMode(in1, OUTPUT);
    pinMode(in2, OUTPUT);
    pinMode(enb, OUTPUT);
    pinMode(in3, OUTPUT);
    pinMode(in4, OUTPUT);

    Particle.function("motor", motorControl);
}

void loop() {
    if (motorsRunning && millis() - lastCommandTime > SAFETY_TIMEOUT) {
        stopMotors();
        motorsRunning = false;
    }
}

void stopMotors() {
    analogWrite(ena, 0);
    analogWrite(enb, 0);
}

void setMotor(int enPin, int fwdPin, int revPin, String action, int speed) {
    if (action == "forward") {
        digitalWrite(fwdPin, HIGH);
        digitalWrite(revPin, LOW);
        analogWrite(enPin, speed);
    } else if (action == "reverse") {
        digitalWrite(fwdPin, LOW);
        digitalWrite(revPin, HIGH);
        analogWrite(enPin, speed);
    } else {
        analogWrite(enPin, 0);
    }
}

// Commands: "forward", "reverse", "stop", "left", "right"
// Optionally with speed: "forward,200"
int motorControl(String command) {
    lastCommandTime = millis();

    int commaIndex = command.indexOf(',');
    String action = command;
    int speed = 150;

    if (commaIndex > 0) {
        action = command.substring(0, commaIndex);
        speed = command.substring(commaIndex + 1).toInt();
        speed = constrain(speed, 0, 255);
    }

    if (action == "forward") {
        setMotor(ena, in1, in2, "forward", speed);
        setMotor(enb, in3, in4, "forward", speed);
        motorsRunning = true;
        return speed;
    }
    if (action == "reverse") {
        setMotor(ena, in1, in2, "reverse", speed);
        setMotor(enb, in3, in4, "reverse", speed);
        motorsRunning = true;
        return speed;
    }
    if (action == "left") {
        setMotor(ena, in1, in2, "reverse", speed);
        setMotor(enb, in3, in4, "forward", speed);
        motorsRunning = true;
        return speed;
    }
    if (action == "right") {
        setMotor(ena, in1, in2, "forward", speed);
        setMotor(enb, in3, in4, "reverse", speed);
        motorsRunning = true;
        return speed;
    }
    if (action == "stop") {
        stopMotors();
        motorsRunning = false;
        return 0;
    }
    return -1;
}
